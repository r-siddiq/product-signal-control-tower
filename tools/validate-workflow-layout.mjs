import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = JSON.parse(
  readFileSync(
    resolve(projectRoot, 'workflows', 'product-signal-control-tower.json'),
    'utf8',
  ),
);
const nodes = workflow.nodes.filter((node) => node.type !== 'n8n-nodes-base.stickyNote');
const notes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.stickyNote');
const byName = new Map(workflow.nodes.map((node) => [node.name, node]));

const groups = {
  'Intake & Replay': [
    'Submit Product Signal',
    'Prepare Safe Intake',
    'Is Signal Valid?',
    'Stop Invalid Signal',
    'Hash Minimized Signal',
    'Claim Event and Check Replay',
    'Is Signal New?',
    'Return Replay Outcome',
  ],
  'AI & Evidence': [
    'Build Extraction Contract',
    'Extract Controlled Signal with GLM-5.2',
    'Validate Extraction or Degrade Safely',
    'Load Reviewed Evidence Candidates',
    'Build Evidence-Backed Brief Contract',
    'Select Evidence and Draft Brief with GLM-5.2',
    'Validate Brief and Build Review Packet',
  ],
  'Human Decision': [
    'Review Product Signal Brief',
    'Persist Review Decision',
    'Route Review Decision',
  ],
  'Auditable Outcomes': [
    'Finalize Approved Artifact and Outbox',
    'Close Without Artifact',
  ],
};

function rect(node) {
  return {
    left: node.position[0],
    top: node.position[1],
    right: node.position[0] + Number(node.parameters.width),
    bottom: node.position[1] + Number(node.parameters.height),
  };
}

function intersects(left, right) {
  return (
    left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top
  );
}

const noteRects = notes.map((note) => ({ name: note.name, ...rect(note) }));
const noteOverlaps = [];
for (let left = 0; left < noteRects.length; left += 1) {
  for (let right = left + 1; right < noteRects.length; right += 1) {
    if (intersects(noteRects[left], noteRects[right])) {
      noteOverlaps.push([noteRects[left].name, noteRects[right].name]);
    }
  }
}

const groupContainment = Object.entries(groups).map(([noteName, memberNames]) => {
  const note = byName.get(noteName);
  const bounds = rect(note);
  const members = memberNames.map((name) => byName.get(name));
  const outside = members.filter((member) => {
    const [x, y] = member.position;
    return (
      x < bounds.left + 40
      || x > bounds.right - 100
      || y < bounds.top + 40
      || y > bounds.bottom - 80
    );
  }).map((member) => member.name);
  return { note: noteName, members: members.length, outside };
});

const nodeCollisions = [];
const nodeWidth = 180;
const nodeHeight = 100;
for (let left = 0; left < nodes.length; left += 1) {
  for (let right = left + 1; right < nodes.length; right += 1) {
    const a = {
      left: nodes[left].position[0],
      right: nodes[left].position[0] + nodeWidth,
      top: nodes[left].position[1],
      bottom: nodes[left].position[1] + nodeHeight,
    };
    const b = {
      left: nodes[right].position[0],
      right: nodes[right].position[0] + nodeWidth,
      top: nodes[right].position[1],
      bottom: nodes[right].position[1] + nodeHeight,
    };
    if (intersects(a, b)) nodeCollisions.push([nodes[left].name, nodes[right].name]);
  }
}

const backwardEdges = [];
let edgeCount = 0;
for (const [sourceName, typed] of Object.entries(workflow.connections)) {
  const source = byName.get(sourceName);
  for (const output of typed.main ?? []) {
    for (const target of output) {
      edgeCount += 1;
      const destination = byName.get(target.node);
      if (destination.position[0] < source.position[0]) {
        backwardEdges.push([sourceName, target.node]);
      }
    }
  }
}

const xValues = nodes.map((node) => node.position[0]);
const mainSpine = nodes.filter((node) => node.position[1] === 0);
const mainSpineX = mainSpine.map((node) => node.position[0]);
const sortedSpineX = [...mainSpineX].sort((left, right) => left - right);
const strictlyLeftToRight = mainSpineX.every((value, index) => value === sortedSpineX[index]);
const branchNodes = nodes.filter((node) => node.position[1] !== 0);
const passed = (
  nodes.length === 20
  && notes.length === 4
  && noteOverlaps.length === 0
  && groupContainment.every((entry) => entry.outside.length === 0)
  && nodeCollisions.length === 0
  && backwardEdges.length === 0
  && strictlyLeftToRight
  && branchNodes.length === 4
);

const evidence = {
  schema_version: '1.0.0',
  synthetic: true,
  status: passed ? 'workflow_layout_acceptance_passed' : 'workflow_layout_acceptance_failed',
  workflow: workflow.name,
  functional_nodes: nodes.length,
  visual_groups: notes.length,
  edge_count: edgeCount,
  horizontal_extent: {
    min_x: Math.min(...xValues),
    max_x: Math.max(...xValues),
  },
  checks: {
    non_overlapping_visual_groups: noteOverlaps.length === 0,
    every_node_inside_its_group: groupContainment.every((entry) => entry.outside.length === 0),
    no_node_collisions: nodeCollisions.length === 0,
    no_backward_edges: backwardEdges.length === 0,
    main_spine_strictly_left_to_right: strictlyLeftToRight,
    branches_separated_vertically: branchNodes.length === 4,
  },
  group_containment: groupContainment,
  violations: {
    note_overlaps: noteOverlaps,
    node_collisions: nodeCollisions,
    backward_edges: backwardEdges,
  },
};

writeFileSync(
  resolve(projectRoot, 'evaluation', 'workflow-layout-captured-results.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
  'utf8',
);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (!passed) process.exitCode = 1;
