import { Badge, Text } from "@cloudflare/kumo";

interface LineageBadgesProps {
  label: string;
  nodeIds: string[];
}

function extractModelName(uniqueId: string): string {
  const parts = uniqueId.split(".");
  return parts[parts.length - 1];
}

export function LineageBadges({ label, nodeIds }: LineageBadgesProps) {
  if (nodeIds.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Text className="text-kumo-subtle text-sm font-medium">{label}:</Text>
      {nodeIds.map((id) => {
        const name = extractModelName(id);
        const isModel = id.startsWith("model.");
        return isModel ? (
          <a key={id} href={`/models/${name}`}>
            <Badge variant="outline">{name}</Badge>
          </a>
        ) : (
          <Badge key={id} variant="outline">
            {name}
          </Badge>
        );
      })}
    </div>
  );
}
