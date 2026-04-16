import { Sidebar } from "@cloudflare/kumo";
import {
  DatabaseIcon,
  TableIcon,
  MagnifyingGlassIcon,
  BookIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Sidebar.Provider>
      <Sidebar>
        <Sidebar.Header>
          <a href="/models" className="flex items-center gap-2 px-2">
            <DatabaseIcon size={24} weight="duotone" />
            <span className="text-lg font-semibold">Data Catalog</span>
          </a>
        </Sidebar.Header>

        <Sidebar.Content>
          <Sidebar.Group>
            <Sidebar.GroupContent>
              <Sidebar.Menu>
                <Sidebar.MenuButton icon={TableIcon} href="/models">
                  Models
                </Sidebar.MenuButton>
                <Sidebar.MenuButton icon={MagnifyingGlassIcon} href="/search">
                  Search
                </Sidebar.MenuButton>
                <Sidebar.MenuButton icon={BookIcon} href="/glossary">
                  Glossary
                </Sidebar.MenuButton>
              </Sidebar.Menu>
            </Sidebar.GroupContent>
          </Sidebar.Group>
        </Sidebar.Content>
      </Sidebar>
      <main className="flex-1 p-6">{children}</main>
    </Sidebar.Provider>
  );
}
