import { Surface, Table, Text } from "@cloudflare/kumo";
import type { CatalogColumn } from "../lib/types";

interface ColumnTableProps {
  columns: CatalogColumn[];
}

export function ColumnTable({ columns }: ColumnTableProps) {
  if (columns.length === 0) {
    return (
      <Text variant="secondary" size="sm">
        No column information available.
      </Text>
    );
  }

  return (
    <Surface className="overflow-hidden rounded-lg">
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.Head>#</Table.Head>
            <Table.Head>Column</Table.Head>
            <Table.Head>Type</Table.Head>
            <Table.Head>Description</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {columns.map((col) => (
            <Table.Row key={col.name}>
              <Table.Cell>{col.index}</Table.Cell>
              <Table.Cell>
                <span className="font-mono font-medium">{col.name}</span>
              </Table.Cell>
              <Table.Cell>
                <span className="font-mono text-kumo-subtle">{col.type}</span>
              </Table.Cell>
              <Table.Cell>{col.description || "—"}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </Surface>
  );
}
