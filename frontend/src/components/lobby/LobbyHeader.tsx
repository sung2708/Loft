"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUIStore } from "@/stores/useUIStore";
import { useAuth } from "@/lib/auth/useAuth";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { LoftMark } from "@/components/brand/LoftMark";
import {
  Sun,
  Moon,
  User as UserIcon,
  LogOut,
  LayoutGrid,
  Plus,
  LogIn,
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
  const { locale, t, toggleLocale } = useTranslation();

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

  const navItems = [{ label: locale === "vi" ? "Phòng" : "Spaces", href: "/", active: pathname === "/" }];

  return (
    <header className="fixed top-0 left-0 right-0 w-full z-50 bg-[var(--bg-loft-base)]/80 backdrop-blur-xl border-b border-[var(--border-loft)] shadow-xs">
      <div className="h-14 w-full max-w-7xl mx-auto px-4 sm:px-8 flex items-center justify-between">
        {/* Brand mark, wordmark, and lobby badge */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <LoftMark className="w-8 h-8 shrink-0 text-[var(--brand-mark)] transition-transform group-hover:scale-105" />
          <span className="loft-wordmark text-lg text-[var(--text-loft-primary)] select-none">
            Mingly
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-loft-muted)] bg-[var(--border-loft)] px-2 py-0.5 rounded-full ml-1 select-none">
            Lobby
          </span>
        </Link>

        {/* Central Navigation Tabs */}
        <nav className="hidden md:flex items-center gap-6">
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`text-sm font-medium transition-colors duration-150 ${
                item.active
                  ? "text-[var(--text-loft-primary)] font-semibold border-b-2 border-[#0066CC] pb-0.5"
                  : "text-[var(--text-loft-secondary)] hover:text-[var(--text-loft-primary)]"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Action Controls: Language + Theme + Auth */}
        <div className="flex items-center gap-2.5">
          {/* Language Switcher Pill */}
          <button
            onClick={toggleLocale}
            title={locale === "vi" ? "Chuyển sang tiếng Anh" : "Switch to Vietnamese"}
            className="btn-press h-8 px-2.5 rounded-lg flex items-center gap-1 text-xs font-semibold text-[var(--text-loft-secondary)] hover:text-[var(--text-loft-primary)] hover:bg-[var(--border-loft)] cursor-pointer transition-colors"
          >
            <span className={locale === "vi" ? "text-[#0066CC]" : ""}>VI</span>
            <span className="text-[var(--text-loft-muted)] opacity-50">/</span>
            <span className={locale === "en" ? "text-[#0066CC]" : ""}>EN</span>
          </button>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            title={
              theme === "dark"
                ? "Chuyển sang giao diện sáng"
                : "Chuyển sang giao diện tối"
            }
            className="btn-press w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-loft-secondary)] hover:text-[var(--text-loft-primary)] hover:bg-[var(--border-loft)] cursor-pointer transition-colors"
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
            <div className="w-8 h-8 rounded-full bg-[var(--border-loft)] animate-pulse" />
          ) : isAuthenticated ? (
            /* Authenticated: Interactive Avatar with Dropdown */
            <div className="relative">
              <button
                ref={avatarButtonRef}
                type="button"
                onClick={() => setIsMenuOpen((prev) => !prev)}
                aria-expanded={isMenuOpen}
                aria-haspopup="menu"
                title={displayName}
                className="btn-press relative w-8 h-8 rounded-full bg-[#0066CC] text-white flex items-center justify-center shadow-xs overflow-hidden cursor-pointer ring-2 ring-transparent hover:ring-[#0066CC]/50 focus:outline-none focus:ring-[#0066CC] transition-all"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="w-full h-full object-cover"
                  />
                ) : initials ? (
                  <span className="text-xs font-semibold leading-none">
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
                  className="absolute right-0 top-full mt-2 w-64 rounded-2xl bg-[var(--bg-loft-card)] border border-[var(--border-loft)] shadow-2xl p-1.5 z-50 text-left animate-in fade-in zoom-in-95 duration-150"
                >
                  {/* User Identity Header */}
                  <div className="p-3 flex items-center gap-3 border-b border-[var(--border-loft)]">
                    <div className="w-10 h-10 rounded-full bg-[#0066CC] text-white flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt={displayName}
                          className="w-full h-full object-cover"
                        />
                      ) : initials ? (
                        <span className="text-sm font-semibold">
                          {initials}
                        </span>
                      ) : (
                        <UserIcon className="w-5 h-5" />
                      )}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-semibold text-[var(--text-loft-primary)] truncate">
                        {displayName}
                      </span>
                      {email && (
                        <span className="text-xs text-[var(--text-loft-muted)] truncate">
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
                      className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-[var(--text-loft-primary)] hover:bg-[var(--border-loft)] transition-colors"
                    >
                      <LayoutGrid className="w-4 h-4 text-[#0066CC]" />
                      <span>{t.account.yourRooms}</span>
                    </Link>

                    <Link
                      href="/home?create=1"
                      onClick={() => setIsMenuOpen(false)}
                      role="menuitem"
                      className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-[var(--text-loft-primary)] hover:bg-[var(--border-loft)] transition-colors"
                    >
                      <Plus className="w-4 h-4 text-[#0066CC]" />
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
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-[#FF3B30] hover:bg-[#FF3B30]/10 transition-colors cursor-pointer"
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
              onClick={() => void signInWithGoogle("/home")}
              className="btn-press h-8 px-3 rounded-xl bg-[var(--bg-loft-surface)] hover:bg-[var(--border-loft)] border border-[var(--border-loft)] text-xs font-semibold text-[var(--text-loft-primary)] flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
            >
              <LogIn className="w-3.5 h-3.5 text-[#0066CC]" />
              <span>{t.common.signIn}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
