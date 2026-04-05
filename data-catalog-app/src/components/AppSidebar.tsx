import { Sidebar } from "@cloudflare/kumo";
import {
  Database,
  Table as TableIcon,
  MagnifyingGlass,
  Gear,
  House,
} from "@phosphor-icons/react";

export function AppSidebar() {
  return (
    <Sidebar.Provider>
      <Sidebar>
        <Sidebar.Header>
          <div className="flex items-center gap-2 px-2">
            <Database size={24} weight="duotone" />
            <span className="text-lg font-semibold">Flame</span>
          </div>
        </Sidebar.Header>

        <Sidebar.Content>
          <Sidebar.Group>
            <Sidebar.GroupContent>
              <Sidebar.Menu>
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton>
                    <House size={20} />
                    Home
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton>
                    <MagnifyingGlass size={20} />
                    Search
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton>
                    <TableIcon size={20} />
                    Datasets
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
              </Sidebar.Menu>
            </Sidebar.GroupContent>
          </Sidebar.Group>
        </Sidebar.Content>

        <Sidebar.Footer>
          <Sidebar.Menu>
            <Sidebar.MenuItem>
              <Sidebar.MenuButton>
                <Gear size={20} />
                Settings
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
          </Sidebar.Menu>
        </Sidebar.Footer>
      </Sidebar>
    </Sidebar.Provider>
  );
}
