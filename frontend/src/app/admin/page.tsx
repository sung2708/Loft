import { Suspense } from "react";
import { AdminPage } from "@/features/admin/AdminPage";

// The admin view keeps its section and filters in the URL; reading search
// params on the client needs a Suspense boundary for static rendering.
export default function Page() {
  return (
    <Suspense>
      <AdminPage />
    </Suspense>
  );
}
