import { Sidebar } from "@cloudflare/kumo";
import {
  DatabaseIcon,
  TableIcon,
  MagnifyingGlassIcon,
  BookIcon,
} from "@phosphor-icons/react";

export function AppSidebar() {
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
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton asChild>
                    <a href="/models">
                      <TableIcon size={20} />
                      Models
                    </a>
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton asChild>
                    <a href="/search">
                      <MagnifyingGlassIcon size={20} />
                      Search
                    </a>
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton asChild>
                    <a href="/glossary">
                      <BookIcon size={20} />
                      Glossary
                    </a>
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
              </Sidebar.Menu>
            </Sidebar.GroupContent>
          </Sidebar.Group>
        </Sidebar.Content>
      </Sidebar>
    </Sidebar.Provider>
  );
}
