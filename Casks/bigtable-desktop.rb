cask "bigtable-desktop" do
  arch arm: "arm64", intel: "x64"

  version "0.1.0"
  sha256 arm:   "8e07ca37f9a883486dab49b0580f38a64bfa0c688674a2121004c38d57f49f2c",
         intel: "948c049cc625c977cc1dd78a238859ac953a5e4dd27406b5edd0a3748055ff2c"

  url "https://github.com/eveenendaal/bigtable-desktop/releases/download/v#{version}/bigtable-desktop-#{version}-#{arch}.dmg"
  name "Bigtable Desktop"
  desc "Desktop client for querying and browsing Google Cloud Bigtable"
  homepage "https://github.com/eveenendaal/bigtable-desktop"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :monterey

  app "Bigtable Desktop.app"

  # The app is ad-hoc signed, not notarized. Clear the quarantine flag so
  # Gatekeeper does not refuse to open it.
  postflight_steps do
    run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{appdir}}/Bigtable Desktop.app"]
  end

  zap trash: [
    "~/Library/Application Support/Bigtable Desktop",
    "~/Library/Logs/Bigtable Desktop",
    "~/Library/Preferences/com.eveenendaal.bigtable-desktop.plist",
    "~/Library/Saved Application State/com.eveenendaal.bigtable-desktop.savedState",
  ]
end
