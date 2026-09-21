import { DisplayRoom } from "./display-room";

export default async function DisplayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <DisplayRoom code={code.toUpperCase()} />;
}
