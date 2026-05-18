# Ruida Direct Integration Research

Date: 2026-05-17

## Question

Can this app communicate directly with an OmTech Polar that uses a Ruida controller, without relying on LightBurn, when the machine is connected over USB?

## Short Answer

Yes, probably, but not through a clean public vendor API.

The Ruida-based machine can communicate with a PC directly over USB, and the app could eventually generate Ruida-compatible job data and transfer it to the controller. However, this is not a small export feature. It is a separate controller-integration project built on a mostly proprietary, community-reverse-engineered protocol.

For this project, direct USB transfer is more realistic than Ethernet because the current shop setup is USB-connected and because Ruida Ethernet workflows commonly rely on UDP, which is known to be less reliable than a fully local wired USB workflow.

## Practical Conclusion For This Project

If direct machine communication is pursued, the recommended order is:

1. Keep the current geometry-first layout, analysis, and SVG export pipeline as the production foundation.
2. Add the ability to generate Ruida-ready `.rd` job content from the same analyzed vector geometry used for export.
3. Add USB-based transfer of the generated job to the Ruida controller.
4. Only after upload is reliable, consider optional controller features such as file management, status polling, and starting a job remotely.

This keeps the app focused on manufacturable geometry first and treats direct machine communication as a later CAM/device layer.

## Why This Looks Feasible

- OmTech documents that laser files can be prepared as `.RD` files and sent to the machine, and that the laser can communicate directly with a computer by USB cable.
- Ruida controller manuals document PC communication over USB2.0 and Ethernet.
- Public reverse-engineering work documents Ruida message formats, coordinate encoding, layer settings, power settings, speed settings, and `.rd`-related message structures.

Taken together, this suggests there is no fundamental barrier to direct integration. The barrier is implementation effort, validation, and production safety.

## Why This Is Not A Simple Feature

### 1. No clear public Ruida developer API was found

The available official materials describe supported operator workflows and hardware communication modes, but they do not provide a current, well-documented public SDK for third-party software to build on.

### 2. Ruida uses a proprietary controller protocol

The protocol details that are useful to software developers appear to come primarily from reverse engineering, not from a stable official integration contract.

### 3. USB is still controller-specific

USB avoids Ruida Ethernet's UDP transport issues, but it does not remove the need to implement Ruida-specific transfer, encoding, job packaging, and controller behavior handling.

### 4. Production safety matters

Any direct integration would need careful handling for:

- machine origin and coordinate assumptions
- file upload and overwrite behavior
- bounds and work-area validation
- per-layer speed and power mapping
- blower and auxiliary output behavior
- job-start versus upload-only workflow
- controller busy/paused/error states
- deterministic output matching the app's analyzed geometry

## Recommended Product Position

For the current production phase, the app should continue to treat SVG export as the primary production path.

Direct Ruida support should be considered an optional later-phase workflow enhancement for internal production use, with USB as the preferred first transport for this shop's setup.

That later work should be framed as:

- a Ruida job-generation feature
- a USB transport feature
- a controller safety and validation feature

not merely as "replace LightBurn."

## Suggested First Direct-Integration Scope

If we decide to build this, the smallest credible first scope is:

1. Export one analyzed badge design as Ruida job data for text and backing only.
2. Upload that job over USB to the controller without auto-start.
3. Verify that the geometry cut on the machine matches the analyzed SVG output.
4. Add operator-visible confirmation around file naming, overwrite, and ready-to-run state.

This avoids combining upload, remote start, jogging, and machine control into the first release.

## Recommendation

The app should not pivot away from SVG/LightBurn-oriented production output yet.

Instead:

- preserve SVG as the primary production export
- keep all geometry decisions based on real outlines and analyzed vector output
- treat Ruida direct USB transfer as a later internal-production integration project once the core layout and export workflow is stable

## Sources Reviewed

- OmTech Help Center: How can I send laser files to my laser?
  - https://help.omtechlaser.com/hc/en-us/articles/32499286111513-How-can-I-send-laser-files-to-my-laser
- OmTech Help Center: What types of files do RDWorks&Lightburn&EZCAD support?
  - https://help.omtechlaser.com/hc/en-us/articles/32500135358233-What-types-of-files-do-RDWorks-Lightburn-EZCAD-support
- Ruida controller manual
  - https://www.ruidacontroller.com/wp-content/uploads/2021/10/RDC6332M-Controller-User-Instruction.pdf
- LightBurn documentation: Ruida Ethernet guide
  - https://docs.lightburnsoftware.com/legacy/Guides/Ruida-Ethernet
- LightBurn documentation: LightBurn Bridge
  - https://docs.lightburnsoftware.com/legacy/LightBurnBridge
- LightBurn forum discussion of Ruida ports and UDP behavior
  - https://forum.lightburnsoftware.com/t/lightburn-firewall-settings/12777
- LightBurn forum discussion with observed UDP handshake behavior
  - https://forum.lightburnsoftware.com/t/sending-basic-commands-via-udp-to-ruida/166604/11
- Reverse engineering of RDCAM / Ruida
  - https://stefan.schuermans.info/rdcam/index.html
  - https://stefan.schuermans.info/rdcam/messages.html
- Ruida protocol summary
  - https://edutechwiki.unige.ch/en/Ruida
- jnweiger/ruida-laser repository
  - https://github.com/jnweiger/ruida-laser
