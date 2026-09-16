import { LegalPage } from "@/components/legal/LegalPage";

export default function TermsPageEnglish() {
  return (
    <LegalPage
      title="Terms of Service"
      summary="These terms govern your use of Mingly, a space for creating rooms, talking, and sharing content with people you invite."
      languageHref="/terms"
      languageLabel="Tiếng Việt"
      backLabel="Back to home"
      updatedLabel="Last updated"
      sections={[
        {
          title: "Using the service",
          content: <p>Use Mingly only for lawful purposes, respect other people, and comply with the terms of connected services such as Google, YouTube, and LiveKit.</p>,
        },
        {
          title: "Rooms and moderation",
          content: <p>Room hosts are responsible for the people they invite and for guest access, passwords, room locks, and moderation actions. Hosts can invite, remove, or block participants through the permissions provided in the app.</p>,
        },
        {
          title: "Prohibited conduct",
          content: <p>Do not use Mingly to harass, defraud, invade privacy, distribute unlawful content, or attempt unauthorized access to a room, account, or system.</p>,
        },
        {
          title: "Third-party services",
          content: <p>Some features rely on third-party services. An interruption, change, or refusal by those services may affect part of Mingly&apos;s functionality.</p>,
        },
        {
          title: "Service changes",
          content: <p>Mingly may update, limit, or discontinue a feature for security, maintenance, or service improvement. Updated terms will be published on this page.</p>,
        },
      ]}
    />
  );
}
