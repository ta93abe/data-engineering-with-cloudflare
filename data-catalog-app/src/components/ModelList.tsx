import { Badge, Input, Surface, Table, Tabs, Text } from "@cloudflare/kumo";
import { useState } from "react";
import type { CatalogModel } from "../lib/types";

type Layer = CatalogModel["layer"] | "all";

const LAYER_TABS: { value: Layer; label: string }[] = [
  { value: "all", label: "All Models" },
  { value: "marts", label: "Marts" },
  { value: "business_vault", label: "Business Vault" },
  { value: "raw_vault", label: "Raw Vault" },
  { value: "staging", label: "Staging" },
];

function LayerBadge({ layer }: { layer: CatalogModel["layer"] }) {
  switch (layer) {
    case "marts":
      return <Badge variant="green">marts</Badge>;
    case "business_vault":
      return <Badge variant="purple">business_vault</Badge>;
    case "raw_vault":
      return <Badge variant="blue">raw_vault</Badge>;
    case "staging":
      return <Badge variant="orange">staging</Badge>;
    default:
      return <Badge variant="outline">{layer}</Badge>;
  }
}

function RunStatusBadge({
  status,
}: {
  status: CatalogModel["lastRunStatus"];
}) {
  if (!status) return <Badge variant="outline">unknown</Badge>;
  switch (status) {
    case "success":
      return <Badge variant="green">success</Badge>;
    case "error":
      return <Badge variant="red">error</Badge>;
    case "warn":
      return <Badge variant="orange">warn</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

interface ModelListProps {
  models: CatalogModel[];
}

export function ModelList({ models }: ModelListProps) {
  const [search, setSearch] = useState("");
  const [selectedLayer, setSelectedLayer] = useState<Layer>("all");

  const lowercasedSearch = search.toLowerCase();

  const filtered = models.filter((m) => {
    const matchesLayer = selectedLayer === "all" || m.layer === selectedLayer;
    const matchesSearch =
      !lowercasedSearch ||
      m.name.toLowerCase().includes(lowercasedSearch) ||
      m.description.toLowerCase().includes(lowercasedSearch) ||
      m.schema.toLowerCase().includes(lowercasedSearch);
    return matchesLayer && matchesSearch;
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Text variant="heading2">Models</Text>
        <Text variant="secondary" size="sm">
          {models.length} model{models.length !== 1 ? "s" : ""} in this project
        </Text>
      </div>

      <Tabs
        variant="underline"
        tabs={LAYER_TABS}
        selectedValue={selectedLayer}
        onValueChange={(v) => setSelectedLayer(v as Layer)}
      />

      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Input
            aria-label="Search models"
            placeholder="Search by name, description, or schema..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Text variant="secondary" size="sm">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </Text>
      </div>

      <Surface className="overflow-hidden rounded-lg">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.Head>Name</Table.Head>
              <Table.Head>Layer</Table.Head>
              <Table.Head>Schema</Table.Head>
              <Table.Head>Materialization</Table.Head>
              <Table.Head>Columns</Table.Head>
              <Table.Head>Last Run</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {filtered.map((model) => (
              <Table.Row key={model.uniqueId}>
                <Table.Cell>
                  <a
                    href={`/models/${model.name}`}
                    className="font-medium hover:underline"
                  >
                    {model.name}
                  </a>
                  {model.description && (
                    <Text variant="secondary" size="xs">
                      {model.description}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <LayerBadge layer={model.layer} />
                </Table.Cell>
                <Table.Cell>
                  <Text variant="mono">{model.schema}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Badge variant="outline">{model.materialization}</Badge>
                </Table.Cell>
                <Table.Cell>{model.columns.length}</Table.Cell>
                <Table.Cell>
                  <RunStatusBadge status={model.lastRunStatus} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </Surface>
    </div>
  );
}
