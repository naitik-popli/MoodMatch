import React from "react";
import LocalStreamPreview from "../components/LocalStreamPreview";

export default function LocalStreamTest() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
      <h1 className="text-3xl font-bold mb-6">Local Stream Test</h1>
      <LocalStreamPreview />
    </div>
  );
}
