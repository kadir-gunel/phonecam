# SPDX-License-Identifier: GPL-3.0-or-later
# The PhoneCam app. It holds the engine (bin/phonecam) and the commands of the
# setup, and it serves them to the front-end over the session bus.
#
# The engine keeps the paths of this directory: the modules of the service and
# the engine live together in <datadir>/phonecam-app/, and the service finds
# the engine beside its own module.

project('phonecam-app', version: '1.0.0', license: 'GPL-3.0-or-later')

prefix = get_option('prefix')
bindir = join_paths(prefix, get_option('bindir'))
datadir = join_paths(prefix, get_option('datadir'))
app_dir = join_paths(datadir, 'phonecam-app')
service_name = 'io.github.kadir_gunel.PhoneCam'

# The launcher runs the service with the gjs of the system.
launcher_conf = configuration_data()
launcher_conf.set('PREFIX', prefix)
launcher_conf.set('DATADIR', datadir)

configure_file(
  input: 'phonecam-app.in',
  output: 'phonecam-app',
  configuration: launcher_conf,
  install: true,
  install_dir: bindir,
  install_mode: 'rwxr-xr-x',
)

# Let the session bus start the service on demand.
service_conf = configuration_data()
service_conf.set('LAUNCHER', join_paths(bindir, 'phonecam-app'))

configure_file(
  input: service_name + '.service.in',
  output: service_name + '.service',
  configuration: service_conf,
  install: true,
  install_dir: join_paths(datadir, 'dbus-1', 'services'),
)

# The modules of the service. The interface sits beside them, because the
# service reads it at its start.
install_data(
  files('src/main.js', 'src/phonecam-service.js', 'src/state.js'),
  install_dir: app_dir,
  install_mode: 'rw-r--r--',
)

install_data(
  service_name + '.xml',
  install_dir: app_dir,
  install_mode: 'rw-r--r--',
)

# The engine and its helpers, beside the modules. The command phonecam-setup
# looks for setup-v4l2loopback.sh in the parent directory of bin/, and that
# script looks for etc/ beside itself.
install_data(
  files('../bin/phonecam', '../bin/phonecam-setup'),
  install_dir: join_paths(app_dir, 'bin'),
  install_mode: 'rwxr-xr-x',
)

install_data(
  '../setup-v4l2loopback.sh',
  install_dir: app_dir,
  install_mode: 'rwxr-xr-x',
)

install_data(
  '../etc/modprobe.d/v4l2loopback.conf',
  install_dir: join_paths(app_dir, 'etc', 'modprobe.d'),
  install_mode: 'rw-r--r--',
)

install_data(
  '../etc/modules-load.d/v4l2loopback.conf',
  install_dir: join_paths(app_dir, 'etc', 'modules-load.d'),
  install_mode: 'rw-r--r--',
)
