/**
 * career-ops-run-analysis
 *
 * Supabase Edge Function — triggers a Career Ops analysis for the
 * authenticated user. Reads the user's active profile from
 * career_ops_user_profiles and the shared job snapshot from the
 * static data files, runs the intelligence + deep-fit logic,
 * and writes results back to career_ops_analyses.
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
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
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Handle poll (GET ?id=...)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const analysisId = url.searchParams.get("id");
    if (!analysisId) {
      return new Response(JSON.stringify({ error: "Missing ?id parameter" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const { data, error } = await supabase
      .from("career_ops_analyses")
      .select("id, status, stage, progress, error, summary_json, queued_at, started_at, completed_at")
      .eq("id", analysisId)
      .eq("user_id", user.id)
      .single();
    if (error || !data) {
      return new Response(JSON.stringify({ error: error?.message || "Not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  // POST — create analysis job
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    let profileId: string | null = body.profileId ?? null;

    // Resolve active profile if not specified
    if (!profileId) {
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
      return new Response(
        JSON.stringify({ error: "No active profile found. Upload a resume first." }),
        { status: 422, headers: { "content-type": "application/json" } },
      );
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
      return new Response(
        JSON.stringify({ analysisId: recent.id, status: recent.status, message: "Analysis already in progress" }),
        { status: 200, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } },
      );
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
    await adminClient.rpc("pg_notify_career_ops_analysis", {
      analysis_id: analysis.id,
      user_id: user.id,
      profile_id: profileId,
    }).catch(() => {
      // pg_notify helper may not exist yet — worker can also poll the analyses table
      console.log("pg_notify not available, worker will poll");
    });

    return new Response(
      JSON.stringify({ analysisId: analysis.id, status: "queued" }),
      {
        status: 202,
        headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
