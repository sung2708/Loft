"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUIStore } from "@/stores/useUIStore";
import { useAuth } from "@/lib/auth/useAuth";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { AppHeader } from "@/components/layout/AppHeader";
import { LocaleToggle } from "@/components/i18n/LocaleToggle";
import {
  Sun,
  Moon,
  User as UserIcon,
  LogOut,
  LayoutGrid,
  Plus,
  LogIn,
  Settings2,
} from "lucide-react";

export const LobbyHeader: React.FC = () => {
  const pathname = usePathname();
  const { theme, toggleTheme } = useUIStore();
  const {
    isLoading,
    isAuthenticated,
    user,
    identity,
    signOut,
    signInWithGoogle,
  } = useAuth();
  const { locale, t } = useTranslation();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);

  // Close menu on click outside or Escape
  useEffect(() => {
    if (!isMenuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        avatarButtonRef.current &&
        !avatarButtonRef.current.contains(e.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMenuOpen(false);
        avatarButtonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  // Compute display details
  const avatarUrl =
    (typeof user?.user_metadata?.avatar_url === "string" &&
      user.user_metadata.avatar_url) ||
    identity?.avatar_url ||
    null;

  const displayName =
    (typeof user?.user_metadata?.full_name === "string" &&
      user.user_metadata.full_name) ||
    (typeof user?.user_metadata?.name === "string" &&
      user.user_metadata.name) ||
    identity?.display_name ||
    user?.email?.split("@")[0] ||
    t.account.guestUser;

  const email = user?.email || "";

  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const roomsHref = isAuthenticated ? "/home" : "/";
  // Preserve current page and query parameters after auth instead of forcing /home
  const currentPath =
    typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : pathname || "/";
  const authNext =
    pathname && !pathname.startsWith("/auth/")
      ? currentPath
      : "/";
  const navItems = [{
    label: isAuthenticated ? t.account.yourRooms : locale === "vi" ? "Phòng" : "Spaces",
    href: roomsHref,
    active: pathname === roomsHref,
  }];

  return (
    <AppHeader
      subtitle=""
      center={
        <nav aria-label={locale === "vi" ? "Điều hướng chính" : "Primary navigation"} className="flex items-center gap-6">
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={`text-[11px] font-medium transition-colors duration-200 ${
                item.active
                  ? "text-[var(--text-loft-primary)] font-medium border-b-2 border-[var(--border-loft)] pb-1"
                  : "text-[var(--text-loft-secondary)] hover:text-[var(--text-loft-primary)]"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      }
      actions={
        <>
          <LocaleToggle />

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            title={
              theme === "dark"
                ? "Chuyển sang giao diện sáng"
                : "Chuyển sang giao diện tối"
            }
            aria-label={
              theme === "dark"
                ? locale === "vi" ? "Chuyển sang giao diện sáng" : "Switch to light theme"
                : locale === "vi" ? "Chuyển sang giao diện tối" : "Switch to dark theme"
            }
            aria-pressed={theme === "dark"}
            className="btn-press hover-invert flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--text-loft-secondary)]"
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>

          {/* Auth State in Header */}
          {isLoading ? (
            /* Subtle anti-flicker loading skeleton */
            <div aria-label={locale === "vi" ? "Đang tải tài khoản" : "Loading account"} className="h-8 w-8 rounded-full bg-[var(--border-loft)] motion-safe:animate-pulse" />
          ) : isAuthenticated ? (
            /* Authenticated: Interactive Avatar with Dropdown */
            <div className="relative">
              <button
                ref={avatarButtonRef}
                type="button"
                onClick={() => setIsMenuOpen((prev) => !prev)}
                aria-expanded={isMenuOpen}
                aria-haspopup="menu"
                aria-label={`${locale === "vi" ? "Tài khoản" : "Account"}: ${displayName}`}
                title={displayName}
                className="btn-press relative w-8 h-8 rounded-full bg-[#101113] text-white flex items-center justify-center shadow-xs overflow-hidden cursor-pointer ring-2 ring-transparent hover:ring-[var(--accent-blue)]/50 focus:outline-none focus:ring-[var(--accent-blue)] transition-all"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="w-full h-full object-cover"
                  />
                ) : initials ? (
                  <span className="text-[11px] font-medium leading-none">
                    {initials}
                  </span>
                ) : (
                  <UserIcon className="w-4 h-4" />
                )}
              </button>

              {/* Account Dropdown Menu */}
              {isMenuOpen && (
                <div
                  ref={menuRef}
                  role="menu"
                  aria-orientation="vertical"
                  className="workflow-panel absolute right-0 top-full z-50 mt-2 w-64 rounded-[6px] p-2 text-left"
                >
                  {/* User Identity Header */}
                  <div className="p-3 flex items-center gap-3 border-b border-[var(--border-loft)]">
                    <div className="w-10 h-10 rounded-full bg-[#101113] text-white flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt={displayName}
                          className="w-full h-full object-cover"
                        />
                      ) : initials ? (
                        <span className="text-[11px] font-medium">
                          {initials}
                        </span>
                      ) : (
                        <UserIcon className="w-5 h-5" />
                      )}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-[11px] font-medium text-[var(--text-loft-primary)] truncate">
                        {displayName}
                      </span>
                      {email && (
                        <span className="text-[11px] text-[var(--text-loft-muted)] truncate">
                          {email}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Navigation Actions */}
                  <div className="py-1">
                    <Link
                      href="/home"
                      onClick={() => setIsMenuOpen(false)}
                      role="menuitem"
                      className="flex items-center gap-3 px-3 py-2 rounded-[6px] text-[11px] font-medium text-[var(--text-loft-primary)] hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] transition-colors"
                    >
                      <LayoutGrid className="w-4 h-4 text-[var(--text-loft-primary)]" />
                      <span>{t.account.yourRooms}</span>
                    </Link>

                    <Link
                      href="/settings"
                      onClick={() => setIsMenuOpen(false)}
                      role="menuitem"
                      className="hover-invert flex items-center gap-3 rounded-[6px] px-3 py-2 text-[11px] font-medium text-[var(--text-loft-primary)] transition-colors duration-200"
                    >
                      <Settings2 aria-hidden="true" className="h-4 w-4" />
                      <span>{locale === "vi" ? "Cài đặt" : "Settings"}</span>
                    </Link>

                    <Link
                      href="/home?create=1"
                      onClick={() => setIsMenuOpen(false)}
                      role="menuitem"
                      className="flex items-center gap-3 px-3 py-2 rounded-[6px] text-[11px] font-medium text-[var(--text-loft-primary)] hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] transition-colors"
                    >
                      <Plus className="w-4 h-4 text-[var(--text-loft-primary)]" />
                      <span>{t.account.createRoom}</span>
                    </Link>
                  </div>

                  {/* Sign Out Action */}
                  <div className="pt-1 border-t border-[var(--border-loft)]">
                    <button
                      type="button"
                      onClick={async () => {
                        setIsMenuOpen(false);
                        await signOut();
                      }}
                      role="menuitem"
                      className="btn-press hover-invert flex w-full items-center gap-3 rounded-[6px] px-3 py-2 text-[11px] font-medium text-[var(--text-loft-primary)]"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>{t.account.signOut}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Logged out: Subtle Sign in button (no fake avatar) */
            <button
              type="button"
              onClick={() => void signInWithGoogle(authNext)}
              className="btn-press hover-invert flex h-8 items-center gap-2 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-3 text-[11px] font-medium text-[var(--text-loft-primary)]"
            >
              <LogIn className="w-3.5 h-3.5 text-[var(--text-loft-primary)]" />
              <span>{t.common.signIn}</span>
            </button>
          )}
        </>
      }
    />
  );
};
