# Release the widget on extensions.gnome.org

The widget is a GNOME Shell extension. The release channel is
extensions.gnome.org. The release needs an account of the owner on that site.

## The package

    cd gnome && ./tools/pack.sh

The command writes `phonecam@kadir-gunel.github.io.shell-extension.zip` in
`gnome/`. The file holds the extension, the engine, the setup commands, the
configuration of the module, the license, and the compiled schema. The file
holds no test, no document, and no tool of the repository.

## The upload

1. Open <https://extensions.gnome.org/upload/> and log in. A visitor without a
   session lands on the login page, so the upload needs an account of the site.
   Without an account, register first:
   <https://extensions.gnome.org/accounts/register/>.
2. Select the file `gnome/phonecam@kadir-gunel.github.io.shell-extension.zip`.
3. The form or the page of the extension asks for a version number. Version 1
   is in review on the site, so the next upload uses `2`.
4. The form or the page asks for the license. Give `GPL-3.0-or-later`.
5. Add a screenshot of the system menu with the row of the widget, and a
   screenshot of the open menu of the widget. A person must take them.
6. Write the note for the reviewer (below).
7. Send the form. A reviewer reads the extension before the publication.

The site runs its own automatic check on each upload (`Shexli`). Read its report
on the review page and correct what it finds. Version 1 had two findings, and
both were true: a synchronous read of a file (`EGO-X-004`) and a compiled schema
in the package (`EGO-P-006`). Both are corrected in version 2.

## The place of the widget

The widget moved from its own panel icon into a row of the standard system menu
(GNOME Quick Settings), as the extensions Caffeine and tailscale-gnome-qs do. The
setting `Show the panel icon` also puts the icon into the panel; it is off at the
start.

The version plan: version 1 is in review on the site. Version 2 holds the two
corrections of the automatic check and is kept beside the repository as
`../phonecam-v2.shell-extension.zip`. Version 3 holds this move. If the corrected
build goes up first, the move uses version 3; if it does not, the move uses
version 2.

## The note for the reviewer

Paste this text in the note field of the form:

> The extension starts and reads the command line program `bin/phonecam`, which
> comes with the extension. That program is also a standalone command line
> program: a user runs the same commands from a terminal, and the shared part of
> the project holds it. The extension itself does the work of the menu only, and
> it calls the program with an argument list, never through a shell.
>
> The program starts other programs, which the user must install: `scrcpy` and
> `adb` (the stream), `ffmpeg` (the preview window), `v4l2loopback` (the virtual
> camera), PipeWire, `pactl`, and `pkexec`. The extension installs no package
> and it starts no package manager: it shows the exact package command in the
> menu when a program is missing.
>
> The one privileged step is the build of the kernel module. The user starts it
> from the menu with the row `Set up the virtual camera`. The command copies the
> root part into `/usr/local/lib/phonecam/` with the owner `root` and then runs
> that root-owned copy, so that no user process can change the file that runs as
> root. The smoke test of the repository reads the argument list of that call.

## After the upload

- The reviewer can ask a question. Answer it in the message thread of the
  submission.
- For each new release: raise the version number of the upload, and add a
  release-record row in `gnome/requirements.md`.
