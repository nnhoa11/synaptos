import PrototypeApp from "@/components/PrototypeApp";
import { getPrototypeMeta } from "@/lib/prototype-data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { stores, snapshots, defaultSnapshot } = await getPrototypeMeta();

  return (
    <PrototypeApp
      stores={stores}
      snapshots={snapshots}
      defaultSnapshot={defaultSnapshot}
    />
  );
}
