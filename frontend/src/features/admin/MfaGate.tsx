"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { useAdminText } from "./shared";

type Step =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "verify"; factorId: string }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "unavailable" };

/**
 * Raises the session to aal2. Supabase recommends sending people through the
 * second factor rather than signing them out; this step does that in place.
 */
export function MfaGate({ onVerified }: { onVerified: () => void }) {
  const { t } = useAdminText();
  const [step, setStep] = useState<Step>(() =>
    getSupabase() ? { kind: "loading" } : { kind: "unavailable" },
  );
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const enrolling = useRef(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    let active = true;
    void (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (!active) return;
      if (error) {
        setStep({ kind: "unavailable" });
        return;
      }
      const verified = data.totp.find((factor) => factor.status === "verified");
      if (verified) {
        setStep({ kind: "verify", factorId: verified.id });
        return;
      }
      setStep({ kind: "setup" });
    })();
    return () => {
      active = false;
    };
  }, [attempt]);

  const enroll = async () => {
    const supabase = getSupabase();
    if (!supabase || enrolling.current) return;
    enrolling.current = true;
    setStep({ kind: "loading" });
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const verified = data.totp[0];
      if (verified) {
        setStep({ kind: "verify", factorId: verified.id });
        return;
      }
      for (const factor of data.all) {
        if (factor.factor_type !== "totp" || factor.status !== "unverified" ||
            !factor.friendly_name?.startsWith("Mingly admin ")) continue;
        const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (error && error.code !== "mfa_factor_not_found") throw error;
      }
      const enrolled = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Mingly admin ${crypto.randomUUID()}`,
      });
      if (enrolled.error || !enrolled.data) throw enrolled.error;
      setStep({
        kind: "enroll",
        factorId: enrolled.data.id,
        qr: enrolled.data.totp.qr_code,
        secret: enrolled.data.totp.secret,
      });
    } catch {
      setStep({ kind: "unavailable" });
    } finally {
      enrolling.current = false;
    }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    const supabase = getSupabase();
    if (
      !supabase ||
      (step.kind !== "verify" && step.kind !== "enroll") ||
      pending
    )
      return;
    setPending(true);
    setError("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: step.factorId,
      code: code.trim(),
    });
    setPending(false);
    if (error) {
      setError(
        t(
          "Mã chưa đúng hoặc đã hết hạn. Nhập mã mới trong ứng dụng.",
          "That code is wrong or expired. Enter the current code from your app.",
        ),
      );
      setCode("");
      return;
    }
    onVerified();
  };

  return (
    <section
      className="admin-panel admin-mfa"
      aria-labelledby="admin-mfa-title"
    >
      <KeyRound size={26} aria-hidden="true" />
      <h2 id="admin-mfa-title">
        {t("Xác minh hai bước", "Two-step verification")}
      </h2>
      {step.kind === "loading" && <p>{t("Đang kiểm tra…", "Checking…")}</p>}
      {step.kind === "setup" && (
        <button type="button" className="admin-button admin-primary" onClick={() => void enroll()}>
          {t("Tạo mã QR", "Create QR code")}
        </button>
      )}
      {step.kind === "unavailable" && (<>
        <p role="alert">
          {t(
            "Không mở được xác minh hai bước. Kiểm tra MFA (TOTP) đã bật trong Supabase Auth.",
            "Two-step verification could not start. Check that MFA (TOTP) is enabled in Supabase Auth.",
          )}
        </p>
        <button type="button" className="admin-button" onClick={() => {
          setStep({ kind: "loading" });
          setAttempt((value) => value + 1);
        }}>
          {t("Thử lại", "Retry")}
        </button>
      </>)}
      {step.kind === "enroll" && (
        <>
          <p>
            {t(
              "Trang quản trị yêu cầu ứng dụng xác thực. Quét mã bằng Google Authenticator, 1Password hoặc ứng dụng tương tự, rồi nhập mã 6 số.",
              "Admin access needs an authenticator app. Scan this code with Google Authenticator, 1Password or similar, then enter the 6-digit code.",
            )}
          </p>
          {/* Supabase returns the QR code as an SVG data URL. */}
          <img
            className="admin-mfa-qr"
            src={step.qr}
            alt={t(
              "Mã QR để thêm Mingly vào ứng dụng xác thực",
              "QR code to add Mingly to your authenticator app",
            )}
            width={180}
            height={180}
          />
          <details className="admin-mfa-secret">
            <summary>
              {t("Không quét được? Nhập khóa", "Can't scan? Enter a key")}
            </summary>
            <code className="mono">{step.secret}</code>
          </details>
          <p className="admin-help">
            {t(
              "Sau khi xác minh, các phiên đăng nhập khác của tài khoản này sẽ bị đăng xuất.",
              "After you verify, this account's other sessions are signed out.",
            )}
          </p>
        </>
      )}
      {(step.kind === "verify" || step.kind === "enroll") && (
        <form onSubmit={(e) => void verify(e)} className="admin-mfa-form">
          <label className="admin-field">
            {t("Mã xác thực", "Verification code")}
            <input
              className="admin-input mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          {error && (
            <p role="alert" className="admin-error">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="admin-button admin-primary"
            disabled={pending || code.length !== 6}
          >
            {pending
              ? t("Đang xác minh…", "Verifying…")
              : t("Xác minh", "Verify")}
          </button>
        </form>
      )}
    </section>
  );
}
