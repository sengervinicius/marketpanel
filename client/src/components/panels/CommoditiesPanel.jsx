import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../utils/api';
import PanelContainer from '../PanelContainer';

const CommoditiesPanel = () => {
  const [prices, setPrices] = useState({});
  const [loading, setLoading]state = useState({
    GC: false,
    CL: false,
    AG: false,
    KA: false,
    PA: false,
    RNG: false,
  });
  const [subsections, setSubsections] = useState({
    GC: true,
    CL: true,
    AG: true,
    KO: true,
    PA: true,
    RNG: true,
  });

  useEffect(() => {
    fetchCommodities();
  }, []);

  const fetchCommodities = async () => {
    setLoading({ GC: true, CL: true, AG: true, KO: true, PA: true, RNG: true });
    try {
      const results = await Promise.all([
        apiFetch('/api/market/commodities?symbol=GC&articles=20'),
        apiFetch('/api/market/commodities?symbol=CL&articles=20'),
        apiFetch('/api/market/commodities?symbol=AGG&articles=20'),
        apiFetch('/api/market/commodities?symbol=KO&articles=20'),
        apiFetch('/api/market/commodities?symbol=PA&articles=20'),
        apiFetch('/api/market/commodities?symbol=RNG&articles=20'),
      ]);
      const [gcData, clData, agData, koData, paData, rngData] = results;
      setPrices({
        GC: gcData?.data?.articles || [],
        CL: clData?.data?.articles || [],
        AG: agData?.data?.articles || [],
        KO: koData?.data?.articles || [],
        PA: paData?.data?.articles || [],
        RNG: rngData?.data?.articles || [],
      });
    } catch (err) {
      console.error('Error fetching commodities:', err);
    } finally {
      setLoading({ GC: false, CL: false, AG: false, KO: false, PA: false, RNG: false });
    }
  };

  const toggleSubsection = (commodity) => {
    setSubsections(prev => ({
      ...prev,
      [commodity]: !prev[commodity],
    }));
  };

  return (
    <PanelContainer
      title="Commodities"
      subsections={subsections}
      toggleSubsection={toggleSubsection}
      prices={prices}
      loading={loading}
    />
  9cý;

export default CommoditiesPanel;
