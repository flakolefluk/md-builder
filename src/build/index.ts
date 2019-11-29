import {
  BuilderOutput,
  createBuilder,
  BuilderContext,
  BuilderRun,
} from '@angular-devkit/architect';
import { JsonObject } from '@angular-devkit/core';
import { Schema } from './schema';
import * as chokidar from 'chokidar';
import * as marked from 'marked';
import * as path from 'path';
import * as fs from 'fs';
import { Observable, from, fromEvent } from 'rxjs';
import { finalize, mergeMap, first, tap } from 'rxjs/operators';

function clearFiles(filesToDelete: string[]) {
  filesToDelete.forEach(file => {
    try {
      fs.unlinkSync(file);
    } catch (e) {
      // do nothing
    }
    return null;
  });
}

function toHtmlPath(path: string): string {
  const index = path.lastIndexOf('.');
  const htmlFileName = path.substring(0, index) + '.html';
  return htmlFileName;
}

function convertFile(path: string): string {
  const content = fs.readFileSync(path, { encoding: 'utf-8' });
  const html = marked(content).replace(/^\t{3}/gm, '');
  const htmlFileName = toHtmlPath(path);
  fs.writeFileSync(htmlFileName, html);
  return htmlFileName;
}

function removeFile(path: string): string {
  const htmlFileName = toHtmlPath(path);
  fs.unlinkSync(htmlFileName);
  return htmlFileName;
}

function _setup(
  options: JsonObject & Schema,
  context: BuilderContext,
): Promise<BuilderRun> {
  return context.scheduleTarget({
    target: options.target,
    project: context.target !== undefined ? context.target.project : '',
  });
}

function _build(
  options: JsonObject & Schema,
  context: BuilderContext,
): Observable<BuilderOutput> {
  marked.setOptions({ headerIds: false });
  const root = context.workspaceRoot;
  const watcher = chokidar.watch(path.join(root, 'src', '**', '*.md'));
  let pathsToDelete: string[] = [];

  watcher
    .on('add', (path: string) => {
      const htmlFile = convertFile(path);
      if (options.log) {
        context.logger.info(`${htmlFile} added`);
      }
      pathsToDelete.push(htmlFile);
    })
    .on('change', (path: string) => {
      const htmlFile = convertFile(path);
      if (options.log) {
        context.logger.info(`${htmlFile} changed`);
      }
    })
    .on('unlink', (path: string) => {
      const htmlFile = removeFile(path);
      if (options.log) {
        context.logger.info(`${htmlFile} removed`);
      }
      pathsToDelete = pathsToDelete.filter(path => path !== htmlFile);
    });

  process.on('SIGINT', () => {
    clearFiles(pathsToDelete);
    watcher.close();
    process.exit(0);
  });

  return fromEvent(watcher, 'ready').pipe(
    tap(() => {
      context.logger.info('Markdown ready...');
    }),
    first(),
    mergeMap(_ => from(_setup(options, context))),
    mergeMap(target =>
      target.output.pipe(
        finalize(() => {
          clearFiles(pathsToDelete);
          watcher.close();
        }),
      ),
    ),
  );
}

export default createBuilder(_build);
