import EinkDisplay from "@/components/eink/EinkDisplay";
import { resolveStoreId } from "@/lib/store-identity";

export const dynamic = "force-dynamic";

export default async function EinkPage({ searchParams }) {
  const params = await searchParams;
  const storeId = resolveStoreId(params?.storeId ?? process.env.STORE_ID ?? "Q7");

  return <EinkDisplay storeId={storeId} />;
}
