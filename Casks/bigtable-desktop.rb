cask "bigtable-desktop" do
  arch arm: "arm64", intel: "x64"

  version "0.1.0"
  sha256 arm:   "0000000000000000000000000000000000000000000000000000000000000000",
         intel: "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/eveenendaal/bigtable-desktop/releases/download/v#{version}/bigtable-desktop-#{version}-#{arch}.dmg"
  name "Bigtable Desktop"
  desc "Desktop client for querying and browsing Google Cloud Bigtable"
  homepage "https://github.com/eveenendaal/bigtable-desktop"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :monterey"

  app "Bigtable Desktop.app"

  # The app is ad-hoc signed, not notarized. Clear the quarantine flag so
  # Gatekeeper does not refuse to open it.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Bigtable Desktop.app"]
  end

  zap trash: [
    "~/Library/Application Support/Bigtable Desktop",
    "~/Library/Logs/Bigtable Desktop",
    "~/Library/Preferences/com.eveenendaal.bigtable-desktop.plist",
    "~/Library/Saved Application State/com.eveenendaal.bigtable-desktop.savedState",
  ]
end
