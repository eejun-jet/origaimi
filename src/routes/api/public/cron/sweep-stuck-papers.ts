import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Sweep papers stuck in `processing` for too long. Cron-safe: idempotent,
// only flips rows with no recent progress so the existing UI Retry button
// becomes reachable.
export const Route = createFileRoute("/api/public/cron/sweep-stuck-papers")({
  server: {
    handlers: {
      POST: async () => {
        const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data, error } = await supabaseAdmin
          .from("past_papers")
          .update({
            parse_status: "failed",
            parse_error: "Worker died during parsing — likely timeout. Click Retry.",
          })
          .eq("parse_status", "processing")
          .lt("updated_at", cutoff)
          .select("id");
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ swept: data?.length ?? 0 }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
