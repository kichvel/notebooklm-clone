import { NotebookWorkspace } from './notebook-workspace';

export default async function NotebookPage({
  params,
}: {
  params: Promise<{ notebookId: string }>;
}) {
  const { notebookId } = await params;
  return <NotebookWorkspace notebookId={notebookId} />;
}
