import { Universe } from "@/app/_components/universe";

export default async function SessionPage({
  params,
}: {
  readonly params: Promise<{ readonly sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <Universe initialEntered sessionId={sessionId} />;
}
