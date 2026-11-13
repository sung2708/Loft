import { Suspense } from "react";
import { headers } from "next/headers";
import { AdminPage } from "@/features/admin/AdminPage";

export default async function Page() {
  const host = (await headers()).get("host");
  const homeHref =
    host === "admin.mingly.site"
      ? process.env.NEXT_PUBLIC_SITE_URL || "https://mingly.site/"
      : "/";
  return (
    <Suspense>
      <AdminPage homeHref={homeHref} />
    </Suspense>
  );
}
