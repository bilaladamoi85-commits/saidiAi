# Golden image (one-time setup, done by hand)
1. Create an Azure NV-series VM (A10 GPU) with Windows 11/Server 2022. Request GPU quota first (support ticket).
2. Install the NVIDIA GRID driver, enable auto-login, disable lock screen and sleep.
3. Install a browser-based streaming server that listens on 8443 over HTTPS (Selkies-GStreamer or Sunshine + moonlight-web), configured to read its access token from C:\cloudplay\token.txt.
4. Create a Scheduled Task "At log on" that runs image\launcher.ps1.
5. Allow inbound TCP 8443 in the subnet's Network Security Group.
6. Run sysprep /generalize, capture as an Azure image, put its resource ID in AZURE_IMAGE_ID.
