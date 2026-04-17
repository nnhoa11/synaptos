import POSApp from "@/components/pos/POSApp";
import { resolveStoreId } from "@/lib/store-identity";

export const dynamic = "force-dynamic";

export default async function PosPage({ searchParams }) {
  const params = await searchParams;
  const storeId = resolveStoreId(params?.storeId ?? process.env.STORE_ID ?? "Q7");

  return <POSApp storeId={storeId} />;
}
