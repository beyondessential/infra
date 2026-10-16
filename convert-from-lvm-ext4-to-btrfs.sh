# Each block is to be run individually, not the whole script at once
# Be careful, check your work, and have fun

# if the ubuntu user account isn't present
# login as root then
visudo # for the NOPASSWD: setup
useradd -m -s /bin/bash -G sudo ubuntu
tailscale up --ssh --qr # if needed

sudo vgs # verify there's at least 12g of free space

sudo lvcreate -L 12G -n root_tmp ubuntu-vg
sudo mkfs.ext4 /dev/ubuntu-vg/root_tmp
sudo mkdir -p /mnt/newroot
sudo mount /dev/ubuntu-vg/root_tmp /mnt/newroot

sudo rsync -aAXH --info=progress2 --exclude={"/dev/*","/proc/*","/sys/*","/tmp/*","/run/*","/mnt/*","/media/*","/lost+found","/swap.img","/opt/sentinelone/mount/*","/opt/sentinelone/ebpfs/*"} / /mnt/newroot/

root_tmp_path=/dev/$(udevadm info --query=symlink --name=/dev/ubuntu-vg/root_tmp | tr ' ' '\n' | grep by-id/dm-uuid)
echo $root_tmp_path
sudo sed -i "/^[^#].*\s\/\s/s|^[^ ]*|$root_tmp_path|" /mnt/newroot/etc/fstab
cat /mnt/newroot/etc/fstab

sudo mount --bind /dev /mnt/newroot/dev
sudo mount --bind /proc /mnt/newroot/proc
sudo mount --bind /sys /mnt/newroot/sys
sudo mount --bind /run /mnt/newroot/run
sudo mount --bind /boot /mnt/newroot/boot
sudo mount --bind /boot/efi /mnt/newroot/boot/efi
sudo chroot /mnt/newroot

update-initramfs -u
update-grub
exit

sudo reboot; exit

# --- once back up and SSH'd in again --- #

# verify the motd says "Usage of /: 70.x% of 11.71GB"
# or something like that

sudo lvremove /dev/ubuntu-vg/ubuntu-lv
sudo lvcreate -L 72G -n root ubuntu-vg

sudo mkfs.btrfs --label ROOT --checksum xxhash --features block-group-tree,squota /dev/ubuntu-vg/root
sudo mkdir -p /mnt/btrfsroot
sudo mount /dev/ubuntu-vg/root /mnt/btrfsroot

cd /mnt/btrfsroot
sudo btrfs sub create @
sudo btrfs sub create @postgres
cd
sudo umount /mnt/btrfsroot

sudo mount -o compress=zstd:1,subvol=@ /dev/ubuntu-vg/root /mnt/btrfsroot
cd /mnt/btrfsroot

sudo btrfs filesystem mkswapfile --size 4G swap.img
sudo swapon swap.img

sudo mkdir -p var/lib/postgresql
sudo mount -o subvol=@postgres /dev/ubuntu-vg/root /mnt/btrfsroot/var/lib/postgresql

sudo rsync -aAXH --info=progress2 --exclude={"/dev/*","/proc/*","/sys/*","/tmp/*","/run/*","/mnt/*","/media/*","/lost+found","/swap.img","/opt/sentinelone/mount/*","/opt/sentinelone/ebpfs/*"} / /mnt/btrfsroot/

new_root_path=/dev/$(udevadm info --query=symlink --name=/dev/ubuntu-vg/root | tr ' ' '\n' | grep by-id/dm-uuid)
echo $new_root_path
sudo sed -i "/^[^#].*\s\/\s/s|^[^ ]*|$new_root_path|" /mnt/btrfsroot/etc/fstab
sudo sed -i "/^[^#].*\s\/\s/s|ext4\s*defaults|btrfs compress=zstd:1,subvol=@|" /mnt/btrfsroot/etc/fstab

sudo tee -a /mnt/btrfsroot/etc/fstab << EOF
$new_root_path /var/lib/postgresql btrfs compress=zstd:1,subvol=@postgres 0 2
EOF
cat /mnt/btrfsroot/etc/fstab

sudo mount --bind /dev /mnt/btrfsroot/dev
sudo mount --bind /proc /mnt/btrfsroot/proc
sudo mount --bind /sys /mnt/btrfsroot/sys
sudo mount --bind /run /mnt/btrfsroot/run
sudo mount --bind /boot /mnt/btrfsroot/boot
sudo mount --bind /boot/efi /mnt/btrfsroot/boot/efi
sudo chroot /mnt/btrfsroot

update-initramfs -u
update-grub
exit

sudo reboot; exit

# then SSH back in to check
findmnt / | cat
# should look like:
#
# TARGET SOURCE                          FSTYPE OPTIONS
# /      /dev/mapper/ubuntu--vg-root[/@] btrfs  rw,relatime,compress=zstd:1,space_cache=v2,subvolid=256,subvol=/@
#
# make sure it's btrfs and subvol=/@

# then cleanup
sudo lvremove /dev/ubuntu-vg/root_tmp
