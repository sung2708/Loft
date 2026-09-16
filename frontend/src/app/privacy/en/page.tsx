import { LegalPage } from "@/components/legal/LegalPage";

export default function PrivacyPageEnglish() {
  return (
    <LegalPage
      title="Privacy Policy"
      summary="This policy explains the data Mingly processes when you sign in, create or join a room, chat, and use room features."
      languageHref="/privacy"
      languageLabel="Tiếng Việt"
      backLabel="Back to home"
      updatedLabel="Last updated"
      sections={[
        {
          title: "Google data and how we use it",
          content: (
            <>
              <p>When you choose Sign in with Google, Mingly receives only the basic profile information you approve: your display name, email address, and profile picture.</p>
              <p>We use this information only to create or sign you in to your account, identify you in the app, and show your profile to people in the same room when needed.</p>
              <p>Mingly does not sell, rent, or use your Google data for advertising. We do not share it with third parties except the service providers needed to operate Mingly, described below, or where required by law.</p>
              <p>You can sign out of Mingly at any time and revoke Mingly&apos;s access from the Security section of your Google Account.</p>
            </>
          ),
        },
        {
          title: "Room usage data",
          content: <p>When you use a room, we process the room name, access settings, participant presence, messages, shared media state, and moderation actions needed to operate the room.</p>,
        },
        {
          title: "Audio, video, and screen sharing",
          content: (
            <>
              <p>Audio, video, and screen sharing are transmitted through LiveKit to provide calls. Mingly does not provide room recording.</p>
              <p>Your browser controls access to your microphone, camera, and screen. You can disable any of these permissions at any time.</p>
            </>
          ),
        },
        {
          title: "Third-party services",
          content: <p>Mingly uses Supabase for authentication and data storage, Google for sign-in, LiveKit for real-time media, and YouTube only when you choose to add YouTube content.</p>,
        },
        {
          title: "Data retention and protection",
          content: <p>We retain room data and messages for as long as needed to operate the service. We enforce server-side access controls and do not expose room passwords, sign-in tokens, or service keys to other users.</p>,
        },
        {
          title: "Policy changes",
          content: <p>When this policy changes, we will update the date at the top of this page. Continued use of Mingly after a change means you have reviewed the updated policy.</p>,
        },
      ]}
    />
  );
}
