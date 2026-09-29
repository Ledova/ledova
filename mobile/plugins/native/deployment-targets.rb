module LedovaDeploymentTargets
  SETTING = 'IPHONEOS_DEPLOYMENT_TARGET'.freeze

  def self.raise_to_podfile_platform(installer)
    floor = podfile_floor(installer)
    return if floor.nil?

    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |configuration|
        current = configuration.build_settings[SETTING]
        next if current.nil? || Gem::Version.new(current.to_s) >= floor

        configuration.build_settings[SETTING] = floor.to_s
      end
    end
  end

  def self.podfile_floor(installer)
    versions = installer.podfile.target_definition_list.map do |definition|
      target = definition.platform&.deployment_target
      Gem::Version.new(target.to_s) if target
    end
    versions.compact.max
  end
end
