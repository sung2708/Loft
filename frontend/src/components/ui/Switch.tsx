"use client";

type SwitchProps = {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
};

export function Switch({ checked, disabled, label, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)] focus:ring-offset-2 focus:ring-offset-[var(--bg-loft-card)] disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? "border-[#101113] bg-[#101113] dark:border-[#f4f5f7] dark:bg-[#f4f5f7]"
          : "border-[#101113] bg-[#d1d5db] dark:border-[#f4f5f7] dark:bg-[#4a4d52]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 rounded-full shadow-md transition-transform duration-200 ease-in-out ${
          checked
            ? "translate-x-5 bg-white dark:bg-[#101113]"
            : "translate-x-0 bg-[#101113] dark:bg-[#f4f5f7]"
        }`}
      />
    </button>
  );
}
