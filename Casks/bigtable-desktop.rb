cask "bigtable-desktop" do
  arch arm: "arm64", intel: "x64"

  version "0.3.0"
  sha256 arm:   "791c79a85aafbfa7a357694907afea0591b0136072443415c5592de95a2cc5a2",
         intel: "4dac1bf51c28e34a55c69457f176be8e314ebf9ddc55827893b9c07ef4514e9d"

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

  # Quits the app during `brew upgrade`; Homebrew reopens it once the new version is installed.
  uninstall quit: "com.eveenendaal.bigtable-desktop"

  zap trash: [
    "~/Library/Application Support/Bigtable Desktop",
    "~/Library/Logs/Bigtable Desktop",
    "~/Library/Preferences/com.eveenendaal.bigtable-desktop.plist",
    "~/Library/Saved Application State/com.eveenendaal.bigtable-desktop.savedState",
  ]
end
