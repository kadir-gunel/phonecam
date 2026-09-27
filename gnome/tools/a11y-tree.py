#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Read the menu of the PhoneCam panel widget through the accessibility
interface of the GNOME Shell instance under test.

  --dump    Print the tree of the gnome-shell application.
  --check   Test the panel button and the menu. Exit 1 on a failure.
"""

import argparse
import re
import sys
import time

import gi

gi.require_version('Atspi', '2.0')
from gi.repository import Atspi  # noqa: E402

PANEL_RE = re.compile(r'^PhoneCam: (streaming|stopped)(?:, (\d+) problems?)?$')

ROTATION_LABELS = ['0 (phone in landscape)', '90', '180', '270']
FOOTER = ['Refresh', 'Settings']
LIVE_LIGHT = 'The camera stream runs'


class Node:
    def __init__(self, role, name, accessible=None):
        self.role = role
        self.name = name
        self.accessible = accessible
        self.children = []

    def finds(self, predicate):
        if predicate(self):
            yield self
        for child in self.children:
            yield from child.finds(predicate)

    def labels(self):
        return [node.name for node in self.finds(lambda item: item.role == 'label') if node.name]


def children(node):
    for index in range(node.get_child_count()):
        try:
            child = node.get_child_at_index(index)
        except Exception:
            continue
        if child is not None:
            yield child


def read(node, root):
    try:
        role = node.get_role_name()
        name = node.get_name()
    except Exception:
        return
    item = Node(role, name, node)
    root.children.append(item)
    for child in children(node):
        read(child, item)


def collect(wait):
    if wait:
        time.sleep(wait)
    desktop = Atspi.get_desktop(0)
    applications = []
    flat = []
    for application in children(desktop):
        try:
            name = application.get_name()
        except Exception:
            continue
        if name == 'gnome-shell':
            holder = Node('application', name)
            read(application, holder)
            applications.append(holder)

    def walk(nodes, depth=0):
        for node in nodes:
            flat.append((depth, node.role, node.name))
            walk(node.children, depth + 1)

    walk(applications)
    return applications, flat


def dump(flat):
    for depth, role, name in flat:
        print('  ' * depth + f'{role}: {name!r}')
    print(f'({len(flat)} nodes)')


def states_of(node):
    if node.accessible is None:
        return []
    states = node.accessible.get_state_set()
    return [name for name in dir(Atspi.StateType)
            if name.isupper() and states.contains(getattr(Atspi.StateType, name))]


def switch_node(nodes, name):
    """The switch row: a check menu item that holds the label of the row."""
    for node in nodes:
        if node.role == 'check menu item' and name in node.labels():
            return node
    return None


def switch_is_on(node):
    """The check box of a switch row carries the state."""
    box = next(node.finds(lambda item: item.role == 'check box'), None)
    return box is not None and 'CHECKED' in states_of(box)


def check(applications, flat, expectations):
    failures = []
    labels = [(role, name) for _, role, name in flat]
    texts = [name for _, _, name in flat]

    panel = None
    for _, role, name in flat:
        match = PANEL_RE.match(name) if role == 'menu' else None
        if match:
            panel = match
            break
    if panel is None:
        failures.append('the panel button of the widget is missing')
    else:
        if panel.group(1) != expectations['state']:
            failures.append(f'the panel button says {panel.group(1)}, expected {expectations["state"]}')
        count = int(panel.group(2) or 0)
        if count != len(expectations['problems']):
            failures.append(f'the panel button reports {count} problems, '
                            f'expected {len(expectations["problems"])}')

    # The light of the running stream. The tree of the shell holds the actor
    # in the two states, even when the shell does not draw it, so the check
    # reads the states of the actor: only a visible actor reaches the screen.
    light_nodes = [node for application in applications
                   for node in application.finds(lambda item: item.name == LIVE_LIGHT)]
    light_shown = any({'VISIBLE', 'SHOWING'} <= set(states_of(node)) for node in light_nodes)
    if expectations['state'] == 'streaming' and not light_shown:
        failures.append(f'the panel button does not show the light {LIVE_LIGHT!r}')
    if expectations['state'] == 'stopped' and light_shown:
        failures.append(f'the panel button shows the light {LIVE_LIGHT!r} '
                        f'although the stream is stopped')

    for required in ['PhoneCam', expectations['toggle'], 'Turn the picture', 'Mirror',
                     'Microphone', 'Camera', 'Preview window', 'Set up the virtual camera',
                     *FOOTER]:
        if required not in texts:
            failures.append(f'the menu does not hold the row {required!r}')

    for label in ROTATION_LABELS:
        if label not in texts:
            failures.append(f'the rotation submenu does not hold {label!r}')

    cameras = [name for name in texts if name.startswith('Camera ') and ' · ' in name]
    if len(cameras) != 4:
        failures.append(f'the camera submenu holds {len(cameras)} rows, expected 4')

    for problem in expectations['problems']:
        if problem not in texts:
            failures.append(f'the menu does not hold the problem {problem!r}')

    pipewire_row = 'Restart PipeWire (for portal applications)'
    if expectations['pipewire_row'] and pipewire_row not in texts:
        failures.append('the menu does not hold the PipeWire row')
    if not expectations['pipewire_row'] and pipewire_row in texts:
        failures.append('the menu holds the PipeWire row although PipeWire holds the camera')

    phone = [name for name in texts if name.startswith('Phone:')]
    if expectations['phone'] and not phone:
        failures.append('the menu does not hold the state of the phone')
    if not expectations['phone'] and phone:
        failures.append(f'the menu holds the state of the phone ({phone[0]})')

    header = [name for name in texts if name.startswith(('Streaming', 'Stopped'))]
    if not header:
        failures.append('the menu does not hold the state line')
    elif not header[0].lower().startswith(expectations['state']):
        failures.append(f'the state line says {header[0]!r}, expected {expectations["state"]}')
    elif expectations['state_line'] not in header[0]:
        failures.append(f'the state line says {header[0]!r}, '
                        f'expected the part {expectations["state_line"]!r}')

    nodes = list(applications[0].finds(lambda item: True)) if applications else []
    for name in ('Mirror', 'Microphone'):
        if switch_node(nodes, name) is None:
            failures.append(f'the row {name!r} is not a switch')
    for wanted in expectations.get('checked', []):
        node = switch_node(nodes, wanted)
        if node is None:
            failures.append(f'the switch {wanted!r} is missing')
        elif not switch_is_on(node):
            failures.append(f'the switch {wanted!r} is not marked as on')

    if not any(name.startswith('Updated ') for name in texts):
        failures.append('the menu does not hold the time of the last read')

    return failures


def wait_for(deadline, predicate):
    """Read the tree again until `predicate` holds or the deadline passes.

    The widget reads the state of the engine without a wait, and it reads the
    state again when the menu opens (REQ-REFR-003). A check that runs in the
    same moment can see the footer `Not read yet` and fail on a slow machine.
    This function waits for the row. A row that never appears still fails.
    """
    applications, flat = collect(0)
    while not predicate(flat) and time.monotonic() < deadline:
        time.sleep(1)
        applications, flat = collect(0)
    return applications, flat


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--wait', type=int, default=0)
    parser.add_argument('--dump', action='store_true')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--state', choices=['streaming', 'stopped'], default='stopped')
    parser.add_argument('--toggle', default=None)
    parser.add_argument('--state-line', default='')
    parser.add_argument('--problems', default='')
    parser.add_argument('--phone', choices=['yes', 'no'], default='no')
    parser.add_argument('--checked', default='')
    parser.add_argument('--expect-pipewire-row', choices=['yes', 'no'], default='no')
    args = parser.parse_args()

    applications, flat = collect(args.wait)
    if args.dump or not args.check:
        dump(flat)
    if not args.check:
        return 0

    expectations = {
        'state': args.state,
        'toggle': args.toggle or ('Stop the stream' if args.state == 'streaming' else 'Start the stream'),
        'state_line': args.state_line,
        'problems': [item for item in args.problems.split(';') if item],
        'phone': args.phone == 'yes',
        'checked': [item for item in args.checked.split(';') if item],
        'pipewire_row': args.expect_pipewire_row == 'yes',
    }
    # The first read of the state is asynchronous, so wait for its row.
    deadline = time.monotonic() + 20
    applications, flat = wait_for(
        deadline, lambda tree: any(name.startswith('Updated ') for _, _, name in tree))

    failures = check(applications, flat, expectations)
    print(f'{len(flat)} accessibility nodes, {len(failures)} failure(s)')
    for failure in failures:
        print(f'FAIL {failure}')
    return 1 if failures else 0


sys.exit(main())
