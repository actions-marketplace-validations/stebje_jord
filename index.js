// Import the necessary dependencies
const core = require('@actions/core')
const github = require('@actions/github')
const ipInfo = require('ipinfo')
const azureRegions = require('./data/azure-regions.json')
const os = require('node:os')
const axios = require('axios').default

async function run() {
  // Get action input parameters
  const token = core.getInput('token')
  const delayTolerance = parseInt(core.getInput('delay-tolerance'))
  const baseUrlCarbonApi = core.getInput('base-url-carbon-aware-api')
  
	// Determine OS of runner
	const RUNNER_PLATFORM = os.platform()
	const RUNNER_OS = await _getRunnerOs(RUNNER_PLATFORM)
	core.info(`Runner OS: ${RUNNER_OS}`)

	// Get IP info of the runner machine
	const IP_INFO = await _getIPInfo()
	core.info(`Runner IP: ${IP_INFO.ip}`)
	core.info(`Runner IP location: ${IP_INFO.region}`)

	// Get Azure region corresponding to runner location
	const RUNNER_LOCATION = await _getRunnerLocation(IP_INFO.region)
	core.info(`Matching Azure region: ${RUNNER_LOCATION}`)

	// Get current emission level at runner location
	const CURRENT_EMISSION_RATING = await _getCurrentEmissionLevel(baseUrlCarbonApi, RUNNER_LOCATION)
	core.info(`Current emission rating in region ${RUNNER_LOCATION}: ${CURRENT_EMISSION_RATING.rating}`)

	// Get forecasted emission level at runner location
  // We don't want to print everything to console by default, to reduce noise. Rather print it to debug log.
	const FORECASTED_EMISSION_RATINGS = await _getForecastedEmissionLevels(baseUrlCarbonApi, RUNNER_LOCATION)
	
  core.info(`Successfully fetched forecasted emission ratings in region ${RUNNER_LOCATION}`)
  core.debug(`Forecasted emission ratings in region ${RUNNER_LOCATION}: ${JSON.stringify(FORECASTED_EMISSION_RATINGS)}`)

  // Get all forecasted emission ratings within the tolerance window (in minutes)
  core.info(`Delay tolerance: ${delayTolerance} minutes`)
  
  const FORECASTED_EMISSION_RATINGS_WITHIN_TOLERANCE = await _getForecastWithinDelayTolerance(FORECASTED_EMISSION_RATINGS[0].forecastData, delayTolerance)
  
  core.info(`Found ${FORECASTED_EMISSION_RATINGS_WITHIN_TOLERANCE.length} forecasted emission ratings within the delay tolerance`)
  core.debug(FORECASTED_EMISSION_RATINGS_WITHIN_TOLERANCE)

  // Find the lowest emission rating available within the tolerance window
  const LOWEST_FORECASTED_EMISSION_RATING = await _getLowestForecastedEmission(FORECASTED_EMISSION_RATINGS_WITHIN_TOLERANCE)
  
  core.info(`Lowest emission rating found within delay tolerance: ${LOWEST_FORECASTED_EMISSION_RATING.value} at ${LOWEST_FORECASTED_EMISSION_RATING.timestamp}`)
  core.debug(LOWEST_FORECASTED_EMISSION_RATING)

  // Calculate how long the job should be delayed (in minutes)
  const JOB_DELAY = await _calculateJobDelay(CURRENT_EMISSION_RATING, LOWEST_FORECASTED_EMISSION_RATING)
  
  core.info(`Calculated job delay: ${JOB_DELAY} minutes`)

  // Determine whether to run the job or not
    // Things to tak into account:
    // - current emission level
    // - forecasted emission level
    // - job type (e.g. cron, pull request, etc.)
    // - job priority (e.g. high, medium, low)
    // - job size (e.g. small, medium, large)
    // - how much tolerance the user has in terms of delaying the job
    // - depenencies on other jobs
    // - ...

	// If job is run, create job summary
	// ...
}

run()

async function _getRunnerOs(platform) {
	switch (platform) {
		case 'linux':
			return 'linux'
		case 'darwin':
			return 'macos'
		case 'win32':
			return 'windows'
		default:
			core.warning('Unable to determine the OS of the runner, the workflow will continue.')
			return
	}
}

async function _getIPInfo() {
	const IPInfo = ipInfo()

	return IPInfo
}

async function _getRunnerLocation(location) {
	let matchingRegions = []

	for (const region in azureRegions) {
		if (azureRegions[region].state == location) {
			matchingRegions.push(region)
		}
	}

	// TODO - how to deal with multiple regions in the same state?
	//   E.g. there are two azure datacenters in Virginia, but it's hard to get granular enough data to distinguish the two
	return matchingRegions[0]
}

async function _getCurrentEmissionLevel(apiUrl, region) {
  const response = await axios.get(`${apiUrl}/emissions/bylocations/best?location=${region}`)
  return response.data[0]
}

async function _getForecastedEmissionLevels(apiUrl, region) {
  const response = await axios.get(`${apiUrl}/emissions/forecasts/current?location=${region}`)
  return response.data
  }

async function _getForecastWithinDelayTolerance(forecastData, delayTolerance) {
  // Find all entries within delay tolerance in minutes
  let maxTimeStamp = new Date(new Date().getTime() + delayTolerance * 60000)
  let currentTime = new Date()

  let forecastWithinTolerance = forecastData.filter((entry) => {
    let forecastTimeStamp = new Date(entry.timestamp)
    // We only want the forecasts that are in the future and within the delay tolerance
    return forecastTimeStamp <= maxTimeStamp && forecastTimeStamp >= currentTime
  }
  )
  return forecastWithinTolerance
}

async function _getLowestForecastedEmission(forecastData) {
  let lowestForecast = forecastData.reduce((prev, current) => {
    return (prev.value < current.value) ? prev : current
  }
  )
  return lowestForecast
}

async function _calculateJobDelay(CURRENT_EMISSION_RATING, LOWEST_FORECASTED_EMISSION_RATING) {
  if (LOWEST_FORECASTED_EMISSION_RATING.value < CURRENT_EMISSION_RATING.rating) {
    let jobDelay = _getTimeDiffMinutes(CURRENT_EMISSION_RATING.time, LOWEST_FORECASTED_EMISSION_RATING.timestamp)
    
    return jobDelay
  } else {
    let jobDelay = 0

    return jobDelay
  }
}

async function _getTimeDiffMinutes(time1, time2) {
  let dt1 = new Date(time1)
  let dt2 = new Date(time2)
  let timeDiffRaw = (dt2.getTime() - dt1.getTime()) / 1000 / 60
  let timeDiff = Math.round(timeDiffRaw)

  return timeDiff
}