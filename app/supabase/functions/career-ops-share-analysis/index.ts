/**
 * career-ops-share-analysis
 *
 * Supabase Edge Function — creates a 7-day shareable snapshot link
 * for a completed analysis, or downloads it as a PDF-friendly JSON.
 *
 * POST /functions/v1/career-ops-share-analysis
 * Body: { "analysisId": "<uuid>", "expiryDays"?: 7 }
 * Returns: { shareId, slug, shareUrl, expiresAt }
 *
 * GET /functions/v1/career-ops-share-analysis?slug=<slug>
 * Returns: { snapshot } — public, no auth required
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

function generateSlug(length = 10): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  // 拒絕取樣：256 不是 36 的倍數，直接取模會讓前幾個字元機率偏高。
  const limit = 256 - (256 % chars.length);
  let out = "";
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out += chars[b % chars.length];
    }
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const siteUrl = Deno.env.get("SITE_URL") || supabaseUrl.replace(".supabase.co", "");

  // Public GET — fetch snapshot by slug (no auth)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");
    if (!slug) {
      return json({ error: "Missing ?slug" }, 400);
    }
    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    // 訪客不能直接 select 這張表（否則可列出全部分享），改用只回一筆的 RPC。
    const { data, error } = await anonClient
      .rpc("get_shared_analysis", { p_slug: slug })
      .maybeSingle<{ snapshot_json: unknown; expires_at: string; created_at: string }>();

    if (error || !data) {
      return json({ error: "Share link not found or expired" }, 404);
    }
    return json({ snapshot: data.snapshot_json, expiresAt: data.expires_at }, 200);
  }

  // POST — create share link (requires auth)
  const authHeader = req.headers.get("Authorization");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader ?? "" } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await req.json();
    const analysisId: string = body.analysisId;
    const expiryDays: number = Math.min(30, Math.max(1, Number(body.expiryDays) || 7));

    if (!analysisId) {
      return json({ error: "Missing analysisId" }, 400);
    }

    // Fetch the analysis (verify ownership + completion)
    const { data: analysis, error: fetchErr } = await supabase
      .from("career_ops_analyses")
      .select("id, status, summary_json, layer_a_json, layer_b_json, layer_c_json, decision_report_json, completed_at")
      .eq("id", analysisId)
      .eq("user_id", user.id)
      .single();

    if (fetchErr || !analysis) {
      return json({ error: "Analysis not found" }, 404);
    }
    if (analysis.status !== "completed") {
      return json({ error: `Analysis status is '${analysis.status}', must be 'completed'` }, 422);
    }

    // Build frozen snapshot
    const snapshot = {
      sharedAt: new Date().toISOString(),
      completedAt: analysis.completed_at,
      summary: analysis.summary_json,
      layerA: analysis.layer_a_json,
      layerB: analysis.layer_b_json,
      layerC: analysis.layer_c_json,
      decisionReport: analysis.decision_report_json,
    };

    const slug = generateSlug(10);
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: share, error: shareErr } = await supabase
      .from("career_ops_shared_analyses")
      .insert({
        slug,
        user_id: user.id,
        analysis_id: analysisId,
        snapshot_json: snapshot,
        expires_at: expiresAt,
      })
      .select("id, slug, expires_at")
      .single();

    if (shareErr || !share) {
      throw new Error(shareErr?.message || "Failed to create share record");
    }

    const shareUrl = `${siteUrl}/?career-ops-share=${share.slug}`;

    return json({ shareId: share.id, slug: share.slug, shareUrl, expiresAt: share.expires_at }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
