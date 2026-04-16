import { Badge, Surface, Text } from "@cloudflare/kumo";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import type { CatalogModel } from "../lib/types";
import { ColumnTable } from "./ColumnTable";
import { LineageBadges } from "./LineageBadges";

interface ModelDetailProps {
  model: CatalogModel;
}

export function ModelDetail({ model }: ModelDetailProps) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <a
          href="/models"
          className="flex items-center gap-1 text-kumo-subtle text-sm hover:text-kumo-default w-fit"
        >
          <ArrowLeftIcon size={16} />
          Back to Models
        </a>
        <Text variant="heading2" as="h1">{model.name}</Text>
        {model.description && (
          <Text variant="secondary">{model.description}</Text>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Surface className="rounded-lg p-4">
          <Text variant="secondary" size="xs">Layer</Text>
          <Text bold>{model.layer}</Text>
        </Surface>
        <Surface className="rounded-lg p-4">
          <Text variant="secondary" size="xs">Schema</Text>
          <Text variant="mono">{model.database}.{model.schema}</Text>
        </Surface>
        <Surface className="rounded-lg p-4">
          <Text variant="secondary" size="xs">Materialization</Text>
          <Text bold>{model.materialization}</Text>
        </Surface>
        <Surface className="rounded-lg p-4">
          <Text variant="secondary" size="xs">Columns</Text>
          <Text bold>{model.columns.length}</Text>
        </Surface>
      </div>

      {model.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Text variant="secondary" size="sm">Tags:</Text>
          {model.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Text variant="heading3">Lineage</Text>
        <LineageBadges label="Depends on" nodeIds={model.dependsOn} />
        <LineageBadges label="Referenced by" nodeIds={model.referencedBy} />
        {model.dependsOn.length === 0 && model.referencedBy.length === 0 && (
          <Text variant="secondary" size="sm">No lineage information available.</Text>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Text variant="heading3">Columns ({model.columns.length})</Text>
        <ColumnTable columns={model.columns} />
      </div>

      <Text variant="mono-secondary">{model.path}</Text>
    </div>
  );
}
