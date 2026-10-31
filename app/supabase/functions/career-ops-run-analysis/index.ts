/**
 * career-ops-run-analysis
 *
 * Optional queue-mode Supabase Edge Function — triggers a Career Ops
 * analysis for the authenticated user. Reads the user's active profile from
 * career_ops_user_profiles and the shared job snapshot from the
 * static data files, queues the analysis, and lets the worker write
 * results back to career_ops_analyses.
 *
 * The default hosted BYOK frontend no longer calls this function; it runs
 * the three-layer match in the browser and only writes completed results
 * to Supabase for sharing. Keep this function for deployments that still
 * want a Railway/Fly.io worker queue.
 *
 * POST /functions/v1/career-ops-run-analysis
 * Body: { "profileId"?: "<uuid>" }  (optional — uses active profile if omitted)
 *
 * Returns: { analysisId, status: "queued" }
 *
 * NOTE: The actual pipeline runs asynchronously. Poll
 *   GET /functions/v1/career-ops-run-analysis?id=<analysisId>
 * until status = "completed" | "failed".
 *
 * Architecture note:
 *   Edge Functions have a 150s wall-clock limit. For full pipeline runs
 *   (scrape + intelligence + deep-fit) use a dedicated worker server
 *   (Railway / Fly.io) triggered via the Supabase pg_notify channel
 *   "career_ops_analysis_queued". This function only creates the queue
 *   record and notifies the worker.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader ?? "" } },
  });

  // Authenticate
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Handle poll (GET ?id=...)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const analysisId = url.searchParams.get("id");
    if (!analysisId) {
      return json({ error: "Missing ?id parameter" }, 400);
    }
    const { data, error } = await supabase
      .from("career_ops_analyses")
      .select("id, status, stage, progress, error, summary_json, layer_a_json, layer_b_json, layer_c_json, decision_report_json, queued_at, started_at, completed_at")
      .eq("id", analysisId)
      .eq("user_id", user.id)
      .single();
    if (error || !data) {
      return json({ error: error?.message || "Not found" }, 404);
    }
    return json(data, 200);
  }

  // POST — create analysis job
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    let profileId: string | null = body.profileId ?? null;

    // Resolve active profile if not specified
    if (profileId) {
      // profile_id 只有外鍵，不保證屬於呼叫者；先確認所有權，避免 worker 用 service role 讀到別人的履歷。
      const { data: owned } = await supabase
        .from("career_ops_user_profiles")
        .select("id")
        .eq("id", profileId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!owned) {
        return json({ error: "Profile not found" }, 404);
      }
    } else {
      const { data: prof } = await supabase
        .from("career_ops_user_profiles")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      profileId = prof?.id ?? null;
    }

    if (!profileId) {
      return json({ error: "No active profile found. Upload a resume first." }, 422);
    }

    // Check for a recent in-progress analysis (debounce: 60s)
    const { data: recent } = await supabase
      .from("career_ops_analyses")
      .select("id, status, queued_at")
      .eq("user_id", user.id)
      .in("status", ["queued", "running"])
      .order("queued_at", { ascending: false })
      .limit(1)
      .single();

    if (recent) {
      return json({ analysisId: recent.id, status: recent.status, message: "Analysis already in progress" }, 200);
    }

    // Create the analysis record
    const { data: analysis, error: insertErr } = await supabase
      .from("career_ops_analyses")
      .insert({
        user_id: user.id,
        profile_id: profileId,
        status: "queued",
        stage: "initializing",
        progress: 0,
      })
      .select("id")
      .single();

    if (insertErr || !analysis) {
      throw new Error(insertErr?.message || "Failed to create analysis record");
    }

    // Notify the worker via pg_notify (worker listens on this channel)
    // Uses service role to call rpc
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    // supabase-js 的 query builder 只實作 then()，沒有 .catch()；錯誤是放在回傳的 { error } 裡。
    const { error: notifyError } = await adminClient.rpc("pg_notify_career_ops_analysis", {
      analysis_id: analysis.id,
      user_id: user.id,
      profile_id: profileId,
    });
    if (notifyError) {
      // pg_notify helper may not exist yet — worker can also poll the analyses table
      console.log("pg_notify not available, worker will poll:", notifyError.message);
    }

    return json({ analysisId: analysis.id, status: "queued" }, 202);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
