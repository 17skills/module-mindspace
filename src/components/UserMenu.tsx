import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, LogOut, Settings, ShieldCheck, User } from "lucide-react";
import { getAccount } from "@/lib/account.functions";
import { listMyOrgs, setActiveOrg } from "@/lib/org.functions";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Avatar-Menü oben rechts: Profil, Einstellungen, Datenschutz, Abmelden. */
export function UserMenu() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const account = useQuery({ queryKey: ["account"], queryFn: () => getAccount() });
  const orgs = useQuery({ queryKey: ["my-orgs"], queryFn: () => listMyOrgs() });

  const switchOrg = useMutation({
    mutationFn: (orgId: string) => setActiveOrg({ data: { orgId } }),
    onSuccess: () => {
      void client.invalidateQueries();
    },
  });

  const email = account.data?.email ?? "";
  const name = account.data?.displayName || email.split("@")[0] || "Konto";
  const initials = name.slice(0, 2).toUpperCase();

  async function signOut() {
    await client.cancelQueries();
    client.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Konto-Menü">
          <Avatar className="h-8 w-8">
            {account.data?.avatarUrl ? (
              <AvatarImage src={account.data.avatarUrl} alt="" />
            ) : null}
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block text-sm">{name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/konto">
            <User className="mr-2 h-4 w-4" aria-hidden="true" />
            Profil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/konto/einstellungen">
            <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
            Einstellungen
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/konto/datenschutz">
            <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
            Datenschutz
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Abmelden
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
