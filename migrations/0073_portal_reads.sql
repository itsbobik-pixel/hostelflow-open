-- Report → RiMovCli: how many portal screenshots Claude read on HostelFlow's key
-- (src/stats/portalread.js allows a few per property; on its own key no limit).
ALTER TABLE properties ADD COLUMN portal_reads INTEGER NOT NULL DEFAULT 0;
