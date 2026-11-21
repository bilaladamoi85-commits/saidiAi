// Real provider: one GPU Windows VM per session, created from your golden image.
const crypto = require('crypto');
const path = require('path');
const { DefaultAzureCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require('@azure/arm-network');
const { BlobServiceClient, BlobSASPermissions } = require('@azure/storage-blob');
const E = process.env;
const REQUIRED = ['AZURE_SUBSCRIPTION_ID', 'AZURE_RESOURCE_GROUP', 'AZURE_LOCATION', 'AZURE_SUBNET_ID', 'AZURE_IMAGE_ID', 'AZURE_STORAGE_CONNECTION'];

class AzureProvider {
  constructor() {
    const missing = REQUIRED.filter(k => !E[k]);
    if (missing.length) throw new Error('Missing env: ' + missing.join(', '));
    const cred = new DefaultAzureCredential();
    this.cmp = new ComputeManagementClient(cred, E.AZURE_SUBSCRIPTION_ID);
    this.net = new NetworkManagementClient(cred, E.AZURE_SUBSCRIPTION_ID);
    this.blobs = BlobServiceClient.fromConnectionString(E.AZURE_STORAGE_CONNECTION).getContainerClient('apps');
    this.rg = E.AZURE_RESOURCE_GROUP; this.loc = E.AZURE_LOCATION; this.port = E.STREAM_PORT || '8443';
  }

  async start(appRow) {
    const id = 'cp' + crypto.randomBytes(5).toString('hex');
    const token = crypto.randomBytes(16).toString('hex');
    try {
      await this.blobs.createIfNotExists();
      const blob = this.blobs.getBlockBlobClient(id + '.bin');
      await blob.uploadFile(path.join(__dirname, 'uploads', appRow.filename));
      const sas = await blob.generateSasUrl({ permissions: BlobSASPermissions.parse('r'), expiresOn: new Date(Date.now() + 3600e3) });

      const pip = await this.net.publicIPAddresses.beginCreateOrUpdateAndWait(this.rg, id + '-ip',
        { location: this.loc, sku: { name: 'Standard' }, publicIPAllocationMethod: 'Static' });
      const nic = await this.net.networkInterfaces.beginCreateOrUpdateAndWait(this.rg, id + '-nic', {
        location: this.loc, ipConfigurations: [{ name: 'ip', subnet: { id: E.AZURE_SUBNET_ID }, publicIPAddress: { id: pip.id } }] });
      await this.cmp.virtualMachines.beginCreateOrUpdateAndWait(this.rg, id, {
        location: this.loc,
        hardwareProfile: { vmSize: E.AZURE_VM_SIZE || 'Standard_NV12ads_A10_v5' },
        storageProfile: { imageReference: { id: E.AZURE_IMAGE_ID }, osDisk: { createOption: 'FromImage', deleteOption: 'Delete' } },
        osProfile: { computerName: id, adminUsername: 'cpadmin', adminPassword: crypto.randomBytes(18).toString('base64url') + 'aA1!' },
        networkProfile: { networkInterfaces: [{ id: nic.id, deleteOption: 'Delete' }] }
      });
      // Download the app and hand it to the launcher task baked into the image (see image/launcher.ps1).
      await this.cmp.virtualMachines.beginRunCommandAndWait(this.rg, id, { commandId: 'RunPowerShellScript', script: [
        'New-Item -ItemType Directory -Force C:\\cloudplay | Out-Null',
        `Invoke-WebRequest -Uri '${sas}' -OutFile C:\\cloudplay\\app.bin`,
        `Set-Content C:\\cloudplay\\token.txt '${token}'`,
        'New-Item C:\\cloudplay\\launch.flag -Force | Out-Null'] });
      return { remoteId: id, streamUrl: `https://${pip.ipAddress}:${this.port}/?token=${token}` };
    } catch (e) { await this.stop(id).catch(() => {}); throw e; }
  }

  async stop(id) {
    const t = fn => fn().catch(() => {});
    await t(() => this.cmp.virtualMachines.beginDeleteAndWait(this.rg, id));
    await t(() => this.net.networkInterfaces.beginDeleteAndWait(this.rg, id + '-nic'));
    await t(() => this.net.publicIPAddresses.beginDeleteAndWait(this.rg, id + '-ip'));
    await t(() => this.blobs.deleteBlob(id + '.bin'));
    return true;
  }
}
module.exports = { AzureProvider };
