import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('Metrics web source boundary', () => {
  it('has no runtime import path from rendering/report reads to a collector or source provider', () => {
    const root = process.cwd(), visited = new Set<string>();
    function inspect(file: string) {
      if (visited.has(file)) return; visited.add(file);
      const source = fs.readFileSync(file, 'utf8');
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      for (const statement of ast.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const clause = statement.importClause;
        if (clause?.isTypeOnly) continue;
        if (!clause?.name && clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.every(e => e.isTypeOnly)) continue;
        const name = statement.moduleSpecifier.text;
        expect(name).not.toMatch(/bigquery|genai|firestore|reports\/(sources|collector|dispatch|transports|store|service|lifecycle|worker-runtime)|plg|one-customer-cohort/);
        if (name === 'google-auth-library') expect(file).toBe(path.join(root, 'src/server/reports/web-client.ts'));
        if (name.startsWith('.')) {
          const base = path.resolve(path.dirname(file), name);
          const target = [base, base + '.ts', base + '.tsx'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
          expect(target, `Unresolved runtime import ${name}`).toBeTruthy();
          inspect(target!);
        }
      }
      expect(source).not.toMatch(/NEXT_PUBLIC_.*(?:SECRET|TOKEN)|after\s*\(|setInterval\s*\(/);
      if (file.endsWith('web-client.ts')) expect(source).not.toMatch(/analytics\.readonly|cloud-platform|getClient\s*\(/);
    }
    inspect(path.join(root, 'src/metrics-web/app/page.tsx'));
    inspect(path.join(root, 'src/metrics-web/app/api/report-jobs/route.ts'));
    expect(visited.size).toBeGreaterThan(5);
  });
});
