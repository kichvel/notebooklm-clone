'use client';

import { useState } from 'react';
import { cn } from 'cn';
import {
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface WorkspaceShellProps {
  sources: React.ReactNode;
  sourcesHeaderAction: React.ReactNode;
  chat: React.ReactNode;
  studio: React.ReactNode;
}

export function WorkspaceShell({ sources, sourcesHeaderAction, chat, studio }: WorkspaceShellProps) {
  const [sourcesCollapsed, setSourcesCollapsed] = useState(false);
  const [studioCollapsed, setStudioCollapsed] = useState(false);

  return (
    <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
      <div
        className={cn(
          'hidden overflow-y-auto border-r border-border lg:flex lg:flex-col lg:shrink-0',
          sourcesCollapsed ? 'lg:w-12' : 'lg:w-80',
        )}
      >
        <div
          data-testid="sources-panel-header"
          className="flex shrink-0 items-center gap-2 border-b border-border p-2"
        >
          {!sourcesCollapsed && <div className="min-w-0 flex-1">{sourcesHeaderAction}</div>}
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label={sourcesCollapsed ? 'Expand sources panel' : 'Collapse sources panel'}
            onClick={() => setSourcesCollapsed((collapsed) => !collapsed)}
          >
            {sourcesCollapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
          </Button>
        </div>
        {!sourcesCollapsed && sources}
      </div>

      <div className="hidden flex-1 flex-col overflow-y-auto lg:flex">{chat}</div>

      <div
        className={cn(
          'hidden overflow-y-auto border-l border-border lg:flex lg:flex-col lg:shrink-0',
          studioCollapsed ? 'lg:w-12' : 'lg:w-80',
        )}
      >
        <div className="flex shrink-0 items-center justify-start border-b border-border p-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={studioCollapsed ? 'Expand studio panel' : 'Collapse studio panel'}
            onClick={() => setStudioCollapsed((collapsed) => !collapsed)}
          >
            {studioCollapsed ? <PanelRightOpenIcon /> : <PanelRightCloseIcon />}
          </Button>
        </div>
        {!studioCollapsed && studio}
      </div>

      <MobileTabs
        sources={sources}
        sourcesHeaderAction={sourcesHeaderAction}
        chat={chat}
        studio={studio}
      />
    </div>
  );
}

function MobileTabs({ sources, sourcesHeaderAction, chat, studio }: WorkspaceShellProps) {
  return (
    <Tabs defaultValue="chat" className="flex flex-1 flex-col overflow-hidden lg:hidden">
      <TabsList className="mx-4 mt-3">
        <TabsTrigger value="sources">Sources</TabsTrigger>
        <TabsTrigger value="chat">Chat</TabsTrigger>
        <TabsTrigger value="studio">Studio</TabsTrigger>
      </TabsList>
      <TabsContent value="sources" className="flex-1 overflow-y-auto">
        <div className="px-3 pt-3">{sourcesHeaderAction}</div>
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
