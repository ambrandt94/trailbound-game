import { describe, expect, test } from 'vitest';
import { SceneStack, type Scene } from '../../src/app/scene-stack';

class Rec implements Scene {
  constructor(
    readonly id: string,
    private readonly log: string[],
  ) {}

  enter(): void {
    this.log.push(`enter:${this.id}`);
  }

  update(): void {
    this.log.push(`update:${this.id}`);
  }

  render(): void {
    this.log.push(`render:${this.id}`);
  }

  exit(): void {
    this.log.push(`exit:${this.id}`);
  }
}

describe('scene stack', () => {
  test('push pauses the scene below without exiting it', async () => {
    const log: string[] = [];
    const stack = new SceneStack();
    const map = new Rec('map', log);
    const area = new Rec('area', log);

    await stack.push(map);
    await stack.push(area);
    stack.update(1 / 120);
    stack.render(0.25);

    expect(log).toEqual(['enter:map', 'enter:area', 'update:area', 'render:area']);
    expect(stack.current()).toBe(area);
    expect(stack.size).toBe(2);
  });

  test('pop exits only the top scene', async () => {
    const log: string[] = [];
    const stack = new SceneStack();
    const map = new Rec('map', log);
    const area = new Rec('area', log);
    await stack.push(map);
    await stack.push(area);

    const popped = await stack.pop();

    expect(popped).toBe(area);
    expect(log.at(-1)).toBe('exit:area');
    expect(stack.current()).toBe(map);
    expect(log).not.toContain('exit:map');
  });

  test('pop on an empty stack returns undefined', async () => {
    const stack = new SceneStack();
    await expect(stack.pop()).resolves.toBeUndefined();
  });

  test('replace exits the current scene before entering the next', async () => {
    const log: string[] = [];
    const stack = new SceneStack();
    await stack.push(new Rec('boot', log));
    await stack.replace(new Rec('title', log));
    expect(log).toEqual(['enter:boot', 'exit:boot', 'enter:title']);
    expect(stack.size).toBe(1);
    expect(stack.current()?.id).toBe('title');
  });

  test('replace on an empty stack just enters the scene', async () => {
    const log: string[] = [];
    const stack = new SceneStack();
    await stack.replace(new Rec('title', log));
    expect(log).toEqual(['enter:title']);
  });

  test('waits for an async enter before resolving push', async () => {
    const stack = new SceneStack();
    let entered = false;
    const scene: Scene = {
      id: 'boot',
      async enter() {
        await Promise.resolve();
        entered = true;
      },
      update() {
        return;
      },
      render() {
        return;
      },
      exit() {
        return;
      },
    };
    await stack.push(scene);
    expect(entered).toBe(true);
  });

  test('keeps a resident scene drawing underneath the top', async () => {
    const log: string[] = [];
    const stack = new SceneStack();
    const map = new Rec('map', log);
    const area = new Rec('area', log);
    await stack.push(map);
    await stack.push(area);
    log.length = 0;

    stack.renderWithResident(0.5, map);

    expect(log).toEqual(['render:map', 'render:area']);
  });

  test('insertUnderTop does not exit the current scene', async () => {
    const log: string[] = [];
    const stack = new SceneStack();
    const map = new Rec('map', log);
    const transition = new Rec('transition', log);
    const area = new Rec('area', log);
    await stack.push(map);
    await stack.push(transition);
    stack.insertUnderTop(area);
    expect(stack.current()).toBe(transition);
    expect(log).toEqual(['enter:map', 'enter:transition', 'enter:area']);
    expect(log).not.toContain('exit:map');
  });
});
