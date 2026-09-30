import { useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Check,
  Languages,
  LogOut,
  Monitor,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  User,
} from "lucide-react";
import { useTheme, type ThemeMode } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { getAccount, saveSettings } from "@/lib/account.functions";
import { DEFAULT_SETTINGS } from "@/lib/settings";
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
  const { theme, setTheme, syncTheme } = useTheme();
  const { language, setLanguage, syncLanguage, t } = useTranslation();

  const storedTheme = account.data?.settings.theme;
  const storedLanguage = account.data?.settings.language;
  useEffect(() => {
    if (storedTheme) syncTheme(storedTheme);
  }, [storedTheme, syncTheme]);
  useEffect(() => {
    if (storedLanguage) syncLanguage(storedLanguage);
  }, [storedLanguage, syncLanguage]);

  const saveAppearance = useMutation({
    mutationFn: (patch: { theme?: ThemeMode; language?: "de" | "en" | "system" }) =>
      saveSettings({
        data: { settings: { ...(account.data?.settings ?? DEFAULT_SETTINGS), ...patch } },
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["account"] }),
  });

  function pickTheme(mode: ThemeMode) {
    setTheme(mode);
    saveAppearance.mutate({ theme: mode });
  }

  function pickLanguage(value: "de" | "en" | "system") {
    setLanguage(value);
    saveAppearance.mutate({ language: value });
  }

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
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={t("menu.account")}>
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
        {(orgs.data?.orgs.length ?? 0) > 1
          ? (orgs.data?.orgs ?? []).map((org) => (
              <DropdownMenuItem key={org.id} onSelect={() => switchOrg.mutate(org.id)}>
                {org.id === orgs.data?.activeOrgId ? (
                  <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                ) : (
                  <Building2 className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                <span className="truncate">{org.name}</span>
              </DropdownMenuItem>
            ))
          : null}
        {(orgs.data?.orgs.length ?? 0) > 1 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem asChild>
          <Link to="/konto">
            <User className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("menu.profile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/konto/organisation">
            <Building2 className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("menu.organisation")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/konto/einstellungen">
            <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("menu.settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/konto/datenschutz">
            <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("menu.privacy")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t("theme.label")}
        </DropdownMenuLabel>
        <div className="flex gap-1 px-2 pb-1">
          {(
            [
              { mode: "light" as const, icon: Sun, label: t("theme.light") },
              { mode: "dark" as const, icon: Moon, label: t("theme.dark") },
              { mode: "system" as const, icon: Monitor, label: t("theme.system") },
            ]
          ).map(({ mode, icon: Icon, label }) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={theme === mode ? "secondary" : "ghost"}
              className="h-8 flex-1"
              aria-label={label}
              aria-pressed={theme === mode}
              title={label}
              onClick={() => pickTheme(mode)}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </Button>
          ))}
        </div>
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Languages className="h-3.5 w-3.5" aria-hidden="true" />
            {t("language.label")}
          </span>
        </DropdownMenuLabel>
        <div className="flex gap-1 px-2 pb-2">
          {(
            [
              { value: "de" as const, label: "DE", full: t("lang.de") },
              { value: "en" as const, label: "EN", full: t("lang.en") },
              { value: "system" as const, label: "Auto", full: t("lang.system") },
            ]
          ).map(({ value, label, full }) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={language === value ? "secondary" : "ghost"}
              className="h-8 flex-1 text-xs"
              aria-pressed={language === value}
              aria-label={full}
              title={full}
              onClick={() => pickLanguage(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Abmelden
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
