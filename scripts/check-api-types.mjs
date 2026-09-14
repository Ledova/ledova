import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import openapiTS, { astToString } from "openapi-typescript";
import ts from "typescript";
import prettier from "prettier";

const root = fileURLToPath(new URL("../", import.meta.url));
const defaultSchema = path.join(root, "backend/schema/openapi.json");
const defaultOutput = path.join(root, "packages/shared/src/generated/api.ts");
const typeNames = new Map([
  ["paths", "ApiPaths"],
  ["webhooks", "ApiWebhooks"],
  ["components", "ApiComponents"],
  ["operations", "ApiOperations"],
  ["$defs", "ApiDefs"],
]);

export function tradingEvents(schema) {
  const stream =
    schema.paths?.["/api/v1/trading/events/stream/"]?.get?.responses?.["200"]
      ?.content?.["text/event-stream"]?.schema;
  const events = stream?.["x-sse-events"];
  const connection = stream?.["x-sse-connection-event"];
  if (
    !Array.isArray(events) ||
    events.length < 2 ||
    events.some((event) => typeof event !== "string" || !event.trim()) ||
    new Set(events).size !== events.length ||
    typeof connection !== "string" ||
    !events.includes(connection)
  ) {
    throw new Error(
      "Trading stream must declare unique x-sse-events and its x-sse-connection-event.",
    );
  }
  return events.filter((event) => event !== connection).sort();
}

function publicTypeNames(context) {
  const rename = (name) =>
    ts.factory.createIdentifier(typeNames.get(name.text) ?? name.text);
  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node)) {
      return ts.factory.updateInterfaceDeclaration(
        node,
        node.modifiers,
        rename(node.name),
        node.typeParameters,
        node.heritageClauses,
        ts.visitNodes(node.members, visit),
      );
    }
    if (ts.isTypeAliasDeclaration(node)) {
      return ts.factory.updateTypeAliasDeclaration(
        node,
        node.modifiers,
        rename(node.name),
        node.typeParameters,
        ts.visitNode(node.type, visit),
      );
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      return ts.factory.updateTypeReferenceNode(
        node,
        rename(node.typeName),
        ts.visitNodes(node.typeArguments, visit),
      );
    }
    if (ts.isPropertySignature(node)) {
      return ts.factory.updatePropertySignature(
        node,
        node.modifiers?.filter(
          (modifier) => modifier.kind !== ts.SyntaxKind.ReadonlyKeyword,
        ),
        node.name,
        node.questionToken,
        ts.visitNode(node.type, visit),
      );
    }
    return ts.visitEachChild(node, visit, context);
  };
  return visit;
}

export async function generateApiTypes(schema) {
  const events = tradingEvents(schema);
  const ast = await openapiTS(schema, {
    alphabetize: true,
    defaultNonNullable: false,
    transform: (definition) =>
      definition.format === "binary"
        ? ts.factory.createTypeReferenceNode("Blob")
        : undefined,
  });
  ast.push(
    ts.factory.createTypeAliasDeclaration(
      [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      "TradingEventType",
      undefined,
      ts.factory.createUnionTypeNode(
        events.map((event) =>
          ts.factory.createLiteralTypeNode(
            ts.factory.createStringLiteral(event),
          ),
        ),
      ),
    ),
  );
  const transformed = ts.transform(ast, [publicTypeNames]);
  try {
    const source = astToString(transformed.transformed, {
      formatOptions: { removeComments: true },
    });
    const options = await prettier.resolveConfig(defaultOutput);
    return await prettier.format(source, { ...options, parser: "typescript" });
  } finally {
    transformed.dispose();
  }
}

export async function checkApiTypes({
  schemaPath = defaultSchema,
  outputPath = defaultOutput,
  update = false,
} = {}) {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const generated = await generateApiTypes(schema);
  if (update) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, generated);
    return;
  }
  const committed = await readFile(outputPath, "utf8");
  if (committed !== generated) {
    throw new Error(
      "Generated API types are stale. Run make update-api-types and review the diff.",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const { values } = parseArgs({
      options: {
        schema: { type: "string", default: defaultSchema },
        output: { type: "string", default: defaultOutput },
        update: { type: "boolean", default: false },
      },
    });
    await checkApiTypes({
      schemaPath: values.schema,
      outputPath: values.output,
      update: values.update,
    });
    console.log(
      values.update
        ? "Generated shared API types."
        : "Generated shared API types match the schema.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
