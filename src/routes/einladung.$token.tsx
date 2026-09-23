import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { acceptInvite, previewInvite } from "@/lib/invites.functions";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/einladung/$token")({
  head: () => ({
    meta: [
      { title: "Einladung — scopebuilder" },
      { name: "description", content: "Nimm deine Einladung zu einer Organisation oder einem Scope an." },
      { property: "og:title", content: "Einladung — scopebuilder" },
      {
        property: "og:description",
        content: "Nimm deine Einladung zu einer Organisation oder einem Scope an.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InvitePage,
});

const ROLE_LABEL: Record<string, string> = {
  owner: "Inhaber",
  admin: "Administrator",
  member: "Mitglied",
  guest: "Gast",
  editor: "Bearbeiten",
  viewer: "Lesen",
};

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [done, setDone] = useState(false);

  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: () => previewInvite({ data: { token } }),
  });

  const accept = useMutation({
    mutationFn: () => acceptInvite({ data: { token } }),
    onSuccess: (result: { boardId?: string | null }) => {
      setDone(true);
      toast.success("Einladung angenommen");
      void navigate({ to: result?.boardId ? "/board/$boardId" : "/", params: { boardId: result?.boardId ?? "" } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!loading && !user && invite.data?.valid) {
      sessionStorage.setItem("invite-return", `/einladung/${token}`);
    }
  }, [loading, user, invite.data, token]);

  const data = invite.data;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-[var(--shadow-card)]">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Einladung</p>

        {invite.isLoading ? <p className="mt-4 text-sm text-muted-foreground">Wird geprüft …</p> : null}

        {data && !data.valid ? (
          <>
            <h1 className="mt-2 font-display text-2xl font-semibold text-brand-navy">Nicht mehr gültig</h1>
            <p className="mt-2 text-sm text-muted-foreground">{data.reason}</p>
            <Button className="mt-6 w-full" onClick={() => void navigate({ to: "/" })}>
              Zur Startseite
            </Button>
          </>
        ) : null}

        {data?.valid ? (
          <>
            <h1 className="mt-2 font-display text-2xl font-semibold text-brand-navy">
              {data.orgName ? data.orgName : data.scopeTitle}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Du wurdest als <strong>{ROLE_LABEL[data.role] ?? data.role}</strong> eingeladen. Die Einladung gilt für{" "}
              <strong>{data.email}</strong>.
            </p>

            {loading ? null : user ? (
              <Button
                className="mt-6 w-full"
                onClick={() => accept.mutate()}
                disabled={accept.isPending || done}
              >
                Einladung annehmen
              </Button>
            ) : (
              <Button className="mt-6 w-full" onClick={() => void navigate({ to: "/auth" })}>
                Anmelden und annehmen
              </Button>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}
