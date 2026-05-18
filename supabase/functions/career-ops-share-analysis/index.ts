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

function generateSlug(length = 10): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

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
  const siteUrl = Deno.env.get("SITE_URL") || supabaseUrl.replace(".supabase.co", "");

  // Public GET — fetch snapshot by slug (no auth)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");
    if (!slug) {
      return new Response(JSON.stringify({ error: "Missing ?slug" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await anonClient
      .from("career_ops_shared_analyses")
      .select("snapshot_json, expires_at, created_at")
      .eq("slug", slug)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error || !data) {
      return new Response(JSON.stringify({ error: "Share link not found or expired" }), {
        status: 404,
        headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    return new Response(JSON.stringify({ snapshot: data.snapshot_json, expiresAt: data.expires_at }), {
      status: 200,
      headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  // POST — create share link (requires auth)
  const authHeader = req.headers.get("Authorization");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader ?? "" } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const analysisId: string = body.analysisId;
    const expiryDays: number = Math.min(30, Math.max(1, Number(body.expiryDays) || 7));

    if (!analysisId) {
      return new Response(JSON.stringify({ error: "Missing analysisId" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    // Fetch the analysis (verify ownership + completion)
    const { data: analysis, error: fetchErr } = await supabase
      .from("career_ops_analyses")
      .select("id, status, summary_json, layer_a_json, layer_b_json, layer_c_json, decision_report_json, completed_at")
      .eq("id", analysisId)
      .eq("user_id", user.id)
      .single();

    if (fetchErr || !analysis) {
      return new Response(JSON.stringify({ error: "Analysis not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    if (analysis.status !== "completed") {
      return new Response(JSON.stringify({ error: `Analysis status is '${analysis.status}', must be 'completed'` }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
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

    return new Response(
      JSON.stringify({ shareId: share.id, slug: share.slug, shareUrl, expiresAt: share.expires_at }),
      {
        status: 201,
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
