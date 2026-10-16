# -*- mode: ruby -*-
# vi: set ft=ruby :
require 'fileutils'

Vagrant.configure("2") do |config|
  # Docs: https://docs.vagrantup.com

  # List: https://vagrantcloud.com/search
  config.vm.box = "cloud-image/ubuntu-24.04"

  config.vm.hostname = "local-ops"

  # Create a forwarded port mapping which allows access to a specific port
  # within the machine from a port on the host machine and only allow access
  # via 127.0.0.1 to disable public access
  # config.vm.network "forwarded_port", guest: 80, host: 8080, host_ip: "127.0.0.1"

  # Mount the repo at ~/ops
  shares = [{source: ".", destination: "/home/vagrant/ops"}]
  config.vm.synced_folder ".", "/vagrant", disabled: true

  # Mount the tailscale state so login is preserved between re-ups
  config.trigger.before :up do |t|
    t.name = "Create tailscale state share if needed"
    t.ruby { FileUtils.mkdir_p(".vagrant/tailscale") }
  end
  shares.push({source: ".vagrant/tailscale", destination: "/var/lib/tailscale"})

  # Mount the .ssh folder so keys are preserved between re-ups
  # This is also where the .gitconfig is, to avoid having another share for one file
  config.trigger.before :up do |t|
    t.name = "Create .ssh share if needed"
    t.ruby { FileUtils.mkdir_p(".vagrant/ssh") }
  end
  shares.push({source: ".vagrant/ssh", destination: "/home/vagrant/.ssh"})

  # Use the default share driver normally, but prefer VirtualBox shares when available
  shares.each do |share|
    config.vm.synced_folder share[:source], share[:destination]
  end
  config.vm.provider "virtualbox" do |vb, override|
    shares.each do |share|
      override.vm.synced_folder share[:source], share[:destination], type: :virtualbox
    end
  end

  config.vm.provider "virtualbox" do |v|
    v.customize ["modifyvm", :id, "--ioapic", "on"]
    v.customize ["modifyvm", :id, "--cpuexecutioncap", "50"]
    if Vagrant::Util::Platform.linux?
      v.customize ["modifyvm", :id, "--graphicscontroller", "None"]
    end
    v.cpus = 2
    v.memory = 2048
  end

  config.vm.provision "file", source: "./ansible/roles/toolbox/files/starship.toml", destination: "/home/vagrant/.config/starship.toml"
  config.vm.provision "shell", inline: "install -Dm644 /home/vagrant/.config/starship.toml /root/.config/starship.toml"
  config.vm.provision "file", source: "./ansible/roles/toolbox/files/tmux.conf.j2", destination: "/home/vagrant/.tmux.conf"
  config.vm.provision "shell", inline: "install -Dm644 /home/vagrant/.tmux.conf /etc/tmux.conf && rm /home/vagrant/.tmux.conf"
  config.vm.provision "file", source: "./ansible/roles/toolbox/files/htoprc", destination: "/home/vagrant/.config/htop/htoprc"
  config.vm.provision "shell", inline: "chsh -s $(which bash) vagrant"

  # Debugging this script is highly annoying with the VirtualBox provider:
  # instead you should comment this line out, and then ssh in and run the
  # script as sudo ops/vagrant.sh
  config.vm.provision "shell", path: "vagrant.sh"
end
