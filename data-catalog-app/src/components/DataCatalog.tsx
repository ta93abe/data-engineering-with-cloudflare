import { Badge, Button, Input, Surface, Table, Tabs, Text } from "@cloudflare/kumo";
import { Plus, ArrowsClockwise } from "@phosphor-icons/react";
import { useState } from "react";

const datasets = [
  {
    name: "github_events",
    source: "GitHub API",
    type: "Table",
    records: "1.2M",
    updated: "2026-04-05",
    status: "active",
  },
  {
    name: "github_repos",
    source: "GitHub API",
    type: "Table",
    records: "340",
    updated: "2026-04-04",
    status: "active",
  },
  {
    name: "cloudflare_analytics",
    source: "Analytics Engine",
    type: "Time Series",
    records: "5.8M",
    updated: "2026-04-05",
    status: "active",
  },
  {
    name: "user_sessions",
    source: "Workers KV",
    type: "Key-Value",
    records: "12K",
    updated: "2026-04-03",
    status: "stale",
  },
  {
    name: "dbt_staging_events",
    source: "dbt / DuckDB",
    type: "View",
    records: "890K",
    updated: "2026-04-05",
    status: "active",
  },
];

function StatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return <Badge variant="green">Active</Badge>;
  }
  return <Badge variant="orange">Stale</Badge>;
}

export function DataCatalog() {
  const [search, setSearch] = useState("");
  const [selectedTab, setSelectedTab] = useState("all");

  const lowercasedSearch = search.toLowerCase();
  const filtered = datasets.filter(
    (d) =>
      (selectedTab === "all" || d.type === selectedTab) &&
      (d.name.toLowerCase().includes(lowercasedSearch) ||
        d.source.toLowerCase().includes(lowercasedSearch))
  );

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <Text className="text-2xl font-bold">Data Catalog</Text>
          <Text className="text-kumo-subtle text-sm">
            Browse and discover datasets across your data platform
          </Text>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<ArrowsClockwise size={16} />}>
            Refresh
          </Button>
          <Button variant="primary" icon={<Plus size={16} />}>
            Add Dataset
          </Button>
        </div>
      </div>

      <Tabs
        variant="underline"
        tabs={[
          { value: "all", label: "All Datasets" },
          { value: "Table", label: "Tables" },
          { value: "View", label: "Views" },
          { value: "Key-Value", label: "Key-Value" },
          { value: "Time Series", label: "Time Series" },
        ]}
        selectedValue={selectedTab}
        onValueChange={setSelectedTab}
      />

      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Input
            aria-label="Search datasets"
            placeholder="Search datasets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Text className="text-kumo-subtle text-sm whitespace-nowrap">
          {filtered.length} dataset{filtered.length !== 1 ? "s" : ""}
        </Text>
      </div>

      <Surface className="overflow-hidden rounded-lg">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.Head>Name</Table.Head>
              <Table.Head>Source</Table.Head>
              <Table.Head>Type</Table.Head>
              <Table.Head>Records</Table.Head>
              <Table.Head>Last Updated</Table.Head>
              <Table.Head>Status</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {filtered.map((dataset) => (
              <Table.Row key={dataset.name}>
                <Table.Cell className="font-medium">{dataset.name}</Table.Cell>
                <Table.Cell>{dataset.source}</Table.Cell>
                <Table.Cell>
                  <Badge variant="outline">{dataset.type}</Badge>
                </Table.Cell>
                <Table.Cell>{dataset.records}</Table.Cell>
                <Table.Cell>{dataset.updated}</Table.Cell>
                <Table.Cell>
                  <StatusBadge status={dataset.status} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </Surface>
    </div>
  );
}
