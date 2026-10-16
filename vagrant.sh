#!/bin/bash

set -euxo pipefail

apt-get -y update
export DEBIAN_FRONTEND=noninteractive

# Adjust tmux config that's pulled from our ansible
sed -i 's/Ctrl+A/Ctrl+T/' /etc/tmux.conf
sed -i 's/C-a/C-t/' /etc/tmux.conf
sed -E -i 's/^set -g status-right .+$/set -g status-right " | LOCAL OPS "/' /etc/tmux.conf

# Baseline
apt-get -y install \
  apt-transport-https \
  build-essential \
  ca-certificates \
  curl \
  dkms \
  dnsutils \
  git \
  linux-headers-$(uname -r) \
  software-properties-common \
  tzdata \
  virtualbox-guest-additions-iso

# Tooling
apt-get -y install \
  bash-completion \
  btrfs-compsize \
  fish \
  gh \
  git \
  gnupg \
  htop \
  hub \
  iftop \
  iotop \
  jq \
  mosh \
  nano \
  neovim \
  nethogs \
  pipx \
  ripgrep \
  tmux \
  tree \
  uuid \
  zsh

# Install bestool from bes-tools repo
apt-get -y install bestool
bestool completions --shell bash > /usr/share/bash-completion/completions/bestool
bestool completions --shell zsh > /usr/share/zsh/site-functions/_bestool
bestool completions --shell fish > /usr/share/fish/vendor_completions.d/bestool.fish

# Install starship
curl -Lo starship.tar.gz \
  https://github.com/starship/starship/releases/latest/download/starship-$(uname -m)-unknown-linux-musl.tar.gz
tar xzf starship.tar.gz -C /usr/bin
rm starship.tar.gz
starship completions bash > /usr/share/bash-completion/completions/starship
starship completions zsh > /usr/share/zsh/site-functions/_starship
starship completions fish > /usr/share/fish/vendor_completions.d/starship.fish
echo 'starship init fish | source' > /etc/fish/conf.d/starship.fish
if ! grep -qF 'eval "$(starship init bash)"' /etc/bash.bashrc; then
  echo 'eval "$(starship init bash)"' >> /etc/bash.bashrc
fi

# Microsoft's edit editor (that we can also have on Windows, and will be native in Win11!)
curl -L https://github.com/microsoft/edit/releases/download/v1.0.0/edit-1.0.0-x86_64-linux-gnu.xz \
  | xz -d > /usr/local/bin/edit
chmod +x /usr/local/bin/edit
if ! grep -qF 'EDITOR=' /etc/environment; then
  echo 'EDITOR=edit' >> /etc/environment
fi

# Node.js (for Pulumi)
apt-get install -y unzip
curl -o- https://fnm.vercel.app/install | sudo -u vagrant bash
sudo -u vagrant bash -ic "source /home/vagrant/.bashrc; fnm install 24"

# Pulumi
curl -fsSL https://get.pulumi.com | sudo -u vagrant sh

# Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Ansible
sudo -u vagrant bash <<EOF
pipx ensurepath
pipx install --include-deps ansible
pipx inject ansible ansible-core
pipx inject ansible dnspython
EOF

sudo -u vagrant tee /home/vagrant/.ansible.cfg <<EOF >/dev/null
[ssh_connection]
ssh_args = -o ControlMaster=auto -o ControlPersist=60s
pipelining = True

[defaults]
interpreter_python = auto_silent

stdout_callback = dense
callback_enabled = yaml, timer, timestamp
EOF

# Gitconfig in .ssh share
if [[ ! -f /home/vagrant/.ssh/gitconfig ]]; then
  sudo -u vagrant cp /home/vagrant/ops/configs/gitconfig /home/vagrant/.ssh/gitconfig
fi
sudo -u vagrant ln -snf /home/vagrant/.ssh/gitconfig /home/vagrant/.gitconfig

# Pull the original authorized_keys from Vagrant
# Otherwise `vagrant ssh` will prompt for a password
mount /dev/sda1 /mnt
sudo -u vagrant cp /mnt/home/vagrant/.ssh/authorized_keys /home/vagrant/.ssh/authorized_keys
umount /mnt

# SSH key for github
if [[ ! -f /home/vagrant/.ssh/id_ed25519 ]]; then
  sudo -u vagrant ssh-keygen -t ed25519 -f /home/vagrant/.ssh/id_ed25519 -N ""
  : Add this public key to your GitHub account
  sudo -u vagrant cat /home/vagrant/.ssh/id_ed25519.pub | cut -d ' ' -f 1-2
fi
