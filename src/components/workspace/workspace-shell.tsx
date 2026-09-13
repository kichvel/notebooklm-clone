'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface WorkspaceShellProps {
  sources: React.ReactNode;
  chat: React.ReactNode;
  studio: React.ReactNode;
}

export function WorkspaceShell({ sources, chat, studio }: WorkspaceShellProps) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
      <div className="hidden overflow-y-auto border-r border-border lg:flex lg:w-80 lg:flex-col lg:shrink-0">
        {sources}
      </div>
      <div className="hidden flex-1 flex-col overflow-y-auto lg:flex">{chat}</div>
      <div className="hidden overflow-y-auto border-l border-border lg:flex lg:w-80 lg:flex-col lg:shrink-0">
        {studio}
      </div>

      <MobileTabs sources={sources} chat={chat} studio={studio} />
    </div>
  );
}

function MobileTabs({ sources, chat, studio }: WorkspaceShellProps) {
  return (
    <Tabs defaultValue="chat" className="flex flex-1 flex-col overflow-hidden lg:hidden">
      <TabsList className="mx-4 mt-3">
        <TabsTrigger value="sources">Sources</TabsTrigger>
        <TabsTrigger value="chat">Chat</TabsTrigger>
        <TabsTrigger value="studio">Studio</TabsTrigger>
      </TabsList>
      <TabsContent value="sources" className="flex-1 overflow-y-auto">
        {sources}
      </TabsContent>
      <TabsContent value="chat" className="flex-1 overflow-y-auto">
        {chat}
      </TabsContent>
      <TabsContent value="studio" className="flex-1 overflow-y-auto">
        {studio}
      </TabsContent>
    </Tabs>
  );
}
